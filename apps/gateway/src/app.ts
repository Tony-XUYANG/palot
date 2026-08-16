/**
 * Authenticated OpenAI-compatible Palot Cloud HTTP application.
 */

import { createHash, createHmac, randomUUID } from "node:crypto"
import { type Context, Hono, type Next } from "hono"
import type { GatewayConfig } from "./config"
import { PALOT_CLOUD_MODELS, resolvePalotCloudModel } from "./models"
import { createPaymentProvider } from "./payment-provider"
import type { PaymentOrder, PaymentProvider, TopupPackage } from "./payments"
import {
	calculateReservation,
	calculateUsageCost,
	estimateRequestInputTokens,
	resolveRequestedOutputTokens,
	type TokenUsage,
} from "./pricing"
import {
	AccountUnavailableError,
	DuplicateRequestError,
	type GatewayAccount,
	type GatewayRepository,
	InsufficientBalanceError,
	RepositoryNotFoundError,
	type ReservationResult,
	type UsageRecord,
} from "./repository"
import {
	createUpstreamRequestBody,
	createUpstreamUrl,
	estimateResponseOutputTokens,
	parseProviderUsage,
	StreamingUsageCollector,
} from "./upstream"

interface GatewayVariables {
	account: GatewayAccount
}

export interface GatewayAppDependencies {
	repository: GatewayRepository
	config: GatewayConfig
	fetch?: GatewayFetch
	paymentProvider?: PaymentProvider | null
	paymentAccountingHealthy?: () => boolean
}

export type GatewayFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

const MAX_REQUEST_BYTES = 5 * 1024 * 1024
const MAX_IDEMPOTENCY_KEY_LENGTH = 128
const TOPUP_ORDER_TTL_MS = 15 * 60 * 1_000

function errorResponse(
	c: Context,
	status: 400 | 401 | 402 | 403 | 404 | 409 | 413 | 429 | 500 | 502 | 503 | 504,
	code: string,
	message: string,
) {
	return c.json({ error: { code, message, type: "palot_cloud_error" } }, status)
}

function readBearerToken(authorization: string | undefined): string | null {
	const match = authorization?.match(/^Bearer\s+(\S+)$/i)
	return match?.[1] ?? null
}

function serializeUsage(record: UsageRecord) {
	return {
		id: record.id,
		model: record.modelId,
		priceVersion: record.priceVersion,
		state: record.state,
		reservedMicros: record.reservedMicros.toString(),
		chargedMicros: record.chargedMicros.toString(),
		usage: record.usage,
		createdAt: record.createdAt,
		settledAt: record.settledAt,
	}
}

function serializeTopupPackage(topupPackage: TopupPackage) {
	return {
		id: topupPackage.id,
		label: topupPackage.label,
		amountMicros: topupPackage.amountMicros.toString(),
		creditMicros: topupPackage.creditMicros.toString(),
		currency: "CNY" as const,
	}
}

function serializePaymentOrder(order: PaymentOrder) {
	return {
		id: order.id,
		packageId: order.packageId,
		channel: order.channel,
		state: order.state,
		amountMicros: order.amountMicros.toString(),
		creditMicros: order.creditMicros.toString(),
		currency: "CNY" as const,
		createdAt: order.createdAt,
		expiresAt: order.expiresAt,
		paidAt: order.paidAt,
		creditedAt: order.creditedAt,
		refundedAt: order.refundedAt,
	}
}

function createCheckoutToken(
	tokenPepper: string,
	accountId: string,
	idempotencyKey: string,
): string {
	return createHmac("sha256", tokenPepper)
		.update(`${accountId}:${idempotencyKey}`)
		.digest("base64url")
}

function hashCheckoutToken(tokenPepper: string, token: string): string {
	return createHash("sha256").update(`${tokenPepper}:${token}`).digest("hex")
}

function checkoutPage(title: string, message: string, form = ""): string {
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'"><title>${title}</title><style>body{font-family:system-ui,sans-serif;max-width:520px;margin:12vh auto;padding:24px;color:#18181b}h1{font-size:24px}p{color:#52525b}button{border:0;border-radius:6px;background:#18181b;color:white;padding:10px 16px;font-weight:600}</style></head><body><h1>${title}</h1><p>${message}</p>${form}</body></html>`
}

function safeIdempotencyKey(value: string | undefined): string {
	const key = value?.trim() || randomUUID()
	if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH || /[^\x21-\x7e]/.test(key)) {
		throw new Error("Idempotency-Key must contain at most 128 visible ASCII characters")
	}
	return key
}

function allowedUpstreamHeaders(headers: Headers): Headers {
	const result = new Headers()
	for (const name of ["content-type", "cache-control", "x-request-id"]) {
		const value = headers.get(name)
		if (value) result.set(name, value)
	}
	return result
}

function createUpstreamAbort(requestSignal: AbortSignal, timeoutMs: number) {
	const controller = new AbortController()
	let timedOut = false
	const abortFromRequest = () => controller.abort(requestSignal.reason)
	requestSignal.addEventListener("abort", abortFromRequest, { once: true })
	const timer = setTimeout(() => {
		timedOut = true
		controller.abort(new Error("Upstream request timed out"))
	}, timeoutMs)
	return {
		signal: controller.signal,
		didTimeOut: () => timedOut,
		dispose: () => {
			clearTimeout(timer)
			requestSignal.removeEventListener("abort", abortFromRequest)
		},
	}
}

async function parseJsonBody(c: Context): Promise<Record<string, unknown>> {
	const contentLength = Number(c.req.header("content-length") ?? "0")
	if (contentLength > MAX_REQUEST_BYTES) throw new Error("REQUEST_TOO_LARGE")
	const text = await c.req.text()
	if (Buffer.byteLength(text, "utf8") > MAX_REQUEST_BYTES) throw new Error("REQUEST_TOO_LARGE")
	const value = JSON.parse(text) as unknown
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Request body must be a JSON object")
	}
	return value as Record<string, unknown>
}

function resolveUsage(value: unknown, inputTokens: number): TokenUsage {
	return (
		parseProviderUsage(value) ?? {
			inputTokens,
			outputTokens: estimateResponseOutputTokens(value),
			cacheReadTokens: 0,
			source: "estimated",
		}
	)
}

export function createGatewayApp(dependencies: GatewayAppDependencies) {
	const app = new Hono<{ Variables: GatewayVariables }>()
	const requestFetch: GatewayFetch = dependencies.fetch ?? fetch
	const paymentProvider =
		dependencies.paymentProvider === undefined
			? createPaymentProvider(dependencies.config)
			: dependencies.paymentProvider
	const paymentsAvailable = () =>
		Boolean(paymentProvider) && (dependencies.paymentAccountingHealthy?.() ?? true)

	app.get("/live", (c) => c.json({ status: "ok" as const }))

	app.get("/health", async (c) => {
		try {
			await dependencies.repository.health()
			return c.json({ status: "ok" as const })
		} catch {
			return c.json({ status: "unavailable" as const }, 503)
		}
	})

	app.use("/v1/*", async (c, next: Next) => {
		const token = readBearerToken(c.req.header("authorization"))
		if (!token)
			return errorResponse(c, 401, "invalid_token", "A Palot Cloud access token is required")
		const account = await dependencies.repository.authenticate(token)
		if (!account) return errorResponse(c, 401, "invalid_token", "The Palot Cloud token is invalid")
		if (account.state !== "active") {
			return errorResponse(c, 403, "account_frozen", "This Palot Cloud account is frozen")
		}
		c.set("account", account)
		await next()
	})

	app.get("/v1/models", async (c) => {
		const prices = await dependencies.repository.listActivePrices()
		const pricesByModel = new Map(prices.map((price) => [price.modelId, price]))
		const data = PALOT_CLOUD_MODELS.flatMap((model) => {
			const price = pricesByModel.get(model.id)
			const credential = dependencies.config.providerCredentials[model.provider]
			if (!price || !credential) return []
			return [
				{
					id: model.id,
					object: "model",
					created: 0,
					owned_by: "palot-cloud",
					name: model.label,
					pricing: {
						currency: "CNY",
						unit: "million_tokens",
						inputMicros: price.inputMicrosPerMillion.toString(),
						outputMicros: price.outputMicrosPerMillion.toString(),
						cacheReadMicros: price.cacheReadMicrosPerMillion.toString(),
						version: price.version,
					},
				},
			]
		})
		return c.json({ object: "list", data })
	})

	app.get("/v1/account", async (c) => {
		const summary = await dependencies.repository.getAccountSummary(c.get("account").id)
		if (!summary) return errorResponse(c, 404, "account_missing", "Palot Cloud account not found")
		return c.json({
			id: summary.id,
			name: summary.name,
			state: summary.state,
			balanceMicros: summary.balanceMicros.toString(),
			currency: "CNY",
			recentUsage: summary.recentUsage.map(serializeUsage),
			recentTopups: summary.recentTopups.map(serializePaymentOrder),
		})
	})

	app.get("/v1/topups/packages", async (c) => {
		const packages = await dependencies.repository.listTopupPackages()
		const available = paymentsAvailable()
		return c.json({
			available,
			channel: available ? (paymentProvider?.channel ?? null) : null,
			data: packages.map(serializeTopupPackage),
		})
	})

	app.post("/v1/topups/orders", async (c) => {
		if (!paymentProvider || !dependencies.config.publicUrl || !paymentsAvailable()) {
			return errorResponse(c, 503, "payments_unavailable", "Top-ups are not available")
		}
		let body: Record<string, unknown>
		try {
			body = await parseJsonBody(c)
		} catch {
			return errorResponse(c, 400, "invalid_request", "Request body must be valid JSON")
		}
		const packageId = typeof body.packageId === "string" ? body.packageId : ""
		let idempotencyKey: string
		try {
			idempotencyKey = safeIdempotencyKey(c.req.header("idempotency-key"))
		} catch (error) {
			return errorResponse(c, 400, "invalid_idempotency_key", (error as Error).message)
		}
		const accountId = c.get("account").id
		const checkoutToken = createCheckoutToken(
			dependencies.config.tokenPepper,
			accountId,
			idempotencyKey,
		)
		try {
			const result = await dependencies.repository.createTopupOrder({
				accountId,
				packageId,
				channel: paymentProvider.channel,
				idempotencyKey,
				checkoutTokenHash: hashCheckoutToken(dependencies.config.tokenPepper, checkoutToken),
				expiresAt: new Date(Date.now() + TOPUP_ORDER_TTL_MS),
			})
			const checkoutUrl = `${dependencies.config.publicUrl}/checkout/${result.order.id}?token=${encodeURIComponent(checkoutToken)}`
			return c.json({
				...serializePaymentOrder(result.order),
				checkoutUrl,
				created: result.created,
			})
		} catch (error) {
			if (error instanceof RepositoryNotFoundError) {
				return errorResponse(c, 404, "package_not_found", "Top-up package not found")
			}
			throw error
		}
	})

	app.get("/v1/topups/orders/:orderId", async (c) => {
		const order = await dependencies.repository.getTopupOrder(
			c.get("account").id,
			c.req.param("orderId"),
		)
		if (!order) return errorResponse(c, 404, "order_not_found", "Top-up order not found")
		return c.json(serializePaymentOrder(order))
	})

	app.get("/checkout/return", (c) =>
		c.html(checkoutPage("Payment submitted", "Return to Palot to view the final balance.")),
	)

	app.get("/checkout/:orderId", async (c) => {
		if (!paymentProvider) return c.html(checkoutPage("Unavailable", "Top-ups are disabled."), 503)
		const token = c.req.query("token") ?? ""
		const order = await dependencies.repository.getCheckoutOrder(
			c.req.param("orderId"),
			hashCheckoutToken(dependencies.config.tokenPepper, token),
		)
		if (!order)
			return c.html(checkoutPage("Invalid checkout", "This checkout link is invalid."), 404)
		if (order.state !== "pending" || new Date(order.expiresAt) < new Date()) {
			await dependencies.repository.closeExpiredTopupOrders(new Date())
			return c.html(checkoutPage("Checkout closed", "This payment order is no longer active."), 410)
		}
		if (paymentProvider.channel === "sandbox") {
			const form = `<form method="post" action="/payments/sandbox/complete"><input type="hidden" name="orderId" value="${order.id}"><input type="hidden" name="token" value="${token}"><button type="submit">Complete sandbox payment</button></form>`
			return c.html(checkoutPage("Palot sandbox checkout", `Order ${order.packageId}`, form))
		}
		return c.redirect(await paymentProvider.createCheckoutUrl(order), 302)
	})

	app.post("/payments/sandbox/complete", async (c) => {
		if (paymentProvider?.channel !== "sandbox") return c.text("not found", 404)
		const form = await c.req.parseBody()
		const orderId = typeof form.orderId === "string" ? form.orderId : ""
		const token = typeof form.token === "string" ? form.token : ""
		const order = await dependencies.repository.getCheckoutOrder(
			orderId,
			hashCheckoutToken(dependencies.config.tokenPepper, token),
		)
		if (!order)
			return c.html(checkoutPage("Invalid checkout", "This checkout link is invalid."), 404)
		await dependencies.repository.completeTopupPayment({
			channel: "sandbox",
			orderId: order.id,
			amountMicros: order.amountMicros,
			providerEventId: `sandbox-event-${order.id}`,
			providerTradeNo: `sandbox-trade-${order.id}`,
			payloadHash: createHash("sha256").update(order.id).digest("hex"),
		})
		return c.html(checkoutPage("Payment complete", "Your Palot Cloud balance is ready."))
	})

	app.post("/payments/alipay/notify", async (c) => {
		if (paymentProvider?.channel !== "alipay") return c.text("failure", 404)
		try {
			const text = await c.req.text()
			if (Buffer.byteLength(text, "utf8") > 1024 * 1024) return c.text("failure", 413)
			const parameters = Object.fromEntries(new URLSearchParams(text))
			const notification = paymentProvider.verifyNotification(parameters)
			await dependencies.repository.completeTopupPayment({
				...notification,
				channel: "alipay",
			})
			return c.text("success")
		} catch {
			return c.text("failure", 400)
		}
	})

	app.post("/v1/chat/completions", async (c) => {
		let body: Record<string, unknown>
		try {
			body = await parseJsonBody(c)
		} catch (error) {
			if (error instanceof Error && error.message === "REQUEST_TOO_LARGE") {
				return errorResponse(c, 413, "request_too_large", "Request body exceeds 5 MiB")
			}
			return errorResponse(c, 400, "invalid_request", "Request body must be valid JSON")
		}
		const model = resolvePalotCloudModel(String(body.model ?? ""))
		if (!model) return errorResponse(c, 404, "model_not_found", "Palot Cloud model not found")
		if (!Array.isArray(body.messages) || body.messages.length === 0) {
			return errorResponse(c, 400, "invalid_messages", "messages must be a non-empty array")
		}
		const credential = dependencies.config.providerCredentials[model.provider]
		if (!credential) {
			return errorResponse(c, 503, "provider_unavailable", "This model is temporarily unavailable")
		}
		const price = await dependencies.repository.getActivePrice(model.id)
		if (!price) return errorResponse(c, 503, "price_unavailable", "This model has no active price")

		let idempotencyKey: string
		try {
			idempotencyKey = safeIdempotencyKey(c.req.header("idempotency-key"))
		} catch (error) {
			return errorResponse(c, 400, "invalid_idempotency_key", (error as Error).message)
		}
		const inputTokens = estimateRequestInputTokens(body.messages)
		const maximumOutputTokens = resolveRequestedOutputTokens(body, model.maxReservationOutputTokens)
		const reservedMicros = calculateReservation(price, inputTokens, maximumOutputTokens)
		let reservation: ReservationResult
		try {
			reservation = await dependencies.repository.reserve({
				accountId: c.get("account").id,
				idempotencyKey,
				modelId: model.id,
				priceVersion: price.version,
				reservedMicros,
			})
			if (!reservation.created) throw new DuplicateRequestError("Duplicate request")
		} catch (error) {
			if (error instanceof InsufficientBalanceError) {
				return errorResponse(c, 402, "insufficient_balance", "Palot Cloud balance is insufficient")
			}
			if (error instanceof AccountUnavailableError) {
				return errorResponse(c, 403, "account_frozen", "This Palot Cloud account is frozen")
			}
			if (error instanceof DuplicateRequestError) {
				return errorResponse(c, 409, "duplicate_request", "This request was already submitted")
			}
			throw error
		}

		const upstreamBody = createUpstreamRequestBody(body, model)
		const upstreamAbort = createUpstreamAbort(
			c.req.raw.signal,
			dependencies.config.upstreamTimeoutMs,
		)
		let upstream: Response
		try {
			upstream = await requestFetch(
				createUpstreamUrl(dependencies.config.providerBaseUrls[model.provider]),
				{
					method: "POST",
					headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" },
					body: JSON.stringify(upstreamBody),
					signal: upstreamAbort.signal,
				},
			)
		} catch {
			upstreamAbort.dispose()
			await dependencies.repository.refund(reservation.usage.id, "Upstream connection failed")
			if (upstreamAbort.didTimeOut() && !c.req.raw.signal.aborted) {
				return errorResponse(c, 504, "upstream_timeout", "The model provider timed out")
			}
			return errorResponse(
				c,
				502,
				"upstream_network_error",
				"The model provider could not be reached",
			)
		}

		if (!upstream.ok || !upstream.body) {
			upstreamAbort.dispose()
			await dependencies.repository.refund(
				reservation.usage.id,
				`Upstream returned HTTP ${upstream.status}`,
			)
			const status = upstream.status === 429 ? 429 : upstream.status >= 500 ? 502 : 503
			return errorResponse(c, status, "upstream_error", "The model provider rejected the request")
		}

		if (body.stream !== true) {
			let value: unknown
			try {
				value = await upstream.json()
			} catch {
				upstreamAbort.dispose()
				await dependencies.repository.refund(reservation.usage.id, "Upstream returned invalid JSON")
				return errorResponse(
					c,
					502,
					"invalid_upstream_response",
					"The model provider returned invalid data",
				)
			}
			const usage = resolveUsage(value, inputTokens)
			await dependencies.repository.settle({
				usageId: reservation.usage.id,
				chargedMicros: calculateUsageCost(price, usage),
				usage,
			})
			upstreamAbort.dispose()
			return c.json(value)
		}

		const reader = upstream.body.getReader()
		const collector = new StreamingUsageCollector()
		let finalized = false
		let streamedBytes = 0
		const finalize = async (refundWhenEmpty: boolean) => {
			if (finalized) return
			finalized = true
			upstreamAbort.dispose()
			collector.finish()
			if (refundWhenEmpty && streamedBytes === 0) {
				await dependencies.repository.refund(reservation.usage.id, "Upstream stream failed")
				return
			}
			const usage = collector.usage(inputTokens)
			await dependencies.repository.settle({
				usageId: reservation.usage.id,
				chargedMicros: calculateUsageCost(price, usage),
				usage,
			})
		}
		const stream = new ReadableStream<Uint8Array>({
			async pull(controller) {
				try {
					const chunk = await reader.read()
					if (chunk.done) {
						await finalize(false)
						controller.close()
						return
					}
					streamedBytes += chunk.value.byteLength
					collector.push(chunk.value)
					controller.enqueue(chunk.value)
				} catch (error) {
					await finalize(true)
					controller.error(error)
				}
			},
			async cancel(reason) {
				await reader.cancel(reason)
				await finalize(true)
			},
		})
		return new Response(stream, {
			status: upstream.status,
			headers: allowedUpstreamHeaders(upstream.headers),
		})
	})

	app.onError((error, c) => {
		console.error("Palot Cloud request failed", { name: error.name, message: error.message })
		return errorResponse(c, 500, "internal_error", "Palot Cloud could not complete the request")
	})

	return app
}
