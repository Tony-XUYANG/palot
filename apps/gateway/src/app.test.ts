import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createGatewayApp, type GatewayFetch } from "./app"
import type { GatewayConfig } from "./config"
import { MemoryGatewayRepository } from "./memory-repository"

const config: GatewayConfig = {
	databaseUrl: "postgresql://unused",
	tokenPepper: "p".repeat(32),
	port: 8080,
	markupBasisPoints: 3_000,
	upstreamTimeoutMs: 25,
	reservationTtlMs: 100,
	paymentMode: "disabled",
	publicUrl: null,
	alipay: null,
	providerCredentials: { deepseek: "server-deepseek-key", zhipuai: "server-zhipu-key" },
	providerBaseUrls: {
		deepseek: "https://deepseek.example.test",
		zhipuai: "https://zhipu.example.test/v4",
	},
}

async function setup(fetchImplementation: GatewayFetch, initialCreditMicros = 100_000_000n) {
	const repository = new MemoryGatewayRepository(config.tokenPepper)
	const account = await repository.createAccount("HTTP user")
	const token = await repository.createToken(account.id)
	if (initialCreditMicros > 0n) {
		await repository.grantCredit({
			accountId: account.id,
			amountMicros: initialCreditMicros,
			idempotencyKey: "initial-credit",
			reason: "HTTP tests",
		})
	}
	await repository.setPrice({
		modelId: "palot-deepseek-chat",
		inputMicrosPerMillion: 1_000_000n,
		outputMicrosPerMillion: 2_000_000n,
		cacheReadMicrosPerMillion: 100_000n,
	})
	const app = createGatewayApp({ repository, config, fetch: fetchImplementation })
	const headers = {
		authorization: `Bearer ${token.rawToken}`,
		"content-type": "application/json",
	}
	return { app, repository, account, headers }
}

describe("Palot Cloud gateway HTTP API", () => {
	it("separates process liveness from database readiness", async () => {
		const { app, repository } = await setup(fetch)
		assert.equal((await app.request("/live")).status, 200)
		repository.health = async () => {
			throw new Error("database unavailable")
		}
		assert.equal((await app.request("/live")).status, 200)
		assert.equal((await app.request("/health")).status, 503)
	})

	it("requires authentication and exposes configured, priced models", async () => {
		const { app, headers } = await setup(fetch)
		assert.equal((await app.request("/v1/models")).status, 401)
		const response = await app.request("/v1/models", { headers })
		assert.equal(response.status, 200)
		const body = (await response.json()) as { data: Array<{ id: string }> }
		assert.deepEqual(
			body.data.map((model) => model.id),
			["palot-deepseek-chat"],
		)
	})

	it("settles provider usage and rejects a repeated idempotency key", async () => {
		let authorization = ""
		let upstreamModel = ""
		const mockFetch = (async (_input, init) => {
			authorization = new Headers(init?.headers).get("authorization") ?? ""
			upstreamModel = String(JSON.parse(String(init?.body)).model)
			return Response.json({
				id: "chatcmpl-test",
				choices: [{ message: { role: "assistant", content: "done" } }],
				usage: { prompt_tokens: 100, completion_tokens: 50 },
			})
		}) satisfies GatewayFetch
		const { app, repository, account, headers } = await setup(mockFetch)
		const request = {
			method: "POST",
			headers: { ...headers, "idempotency-key": "edit-1" },
			body: JSON.stringify({
				model: "palot-deepseek-chat",
				messages: [{ role: "user", content: "Change the page" }],
				max_tokens: 200,
			}),
		}
		assert.equal((await app.request("/v1/chat/completions", request)).status, 200)
		assert.equal(authorization, "Bearer server-deepseek-key")
		assert.equal(upstreamModel, "deepseek-v4-flash")
		const summary = await repository.getAccountSummary(account.id)
		assert.equal(summary?.recentUsage[0]?.chargedMicros, 200n)
		assert.equal(summary?.recentUsage[0]?.usage?.source, "provider")
		const duplicate = await app.request("/v1/chat/completions", request)
		assert.equal(duplicate.status, 409)
	})

	it("refunds an upstream rejection without exposing provider details", async () => {
		const mockFetch = (async () =>
			new Response('{"error":{"message":"provider secret detail"}}', {
				status: 500,
			})) satisfies GatewayFetch
		const { app, repository, account, headers } = await setup(mockFetch)
		const response = await app.request("/v1/chat/completions", {
			method: "POST",
			headers,
			body: JSON.stringify({
				model: "palot-deepseek-chat",
				messages: [{ role: "user", content: "test" }],
			}),
		})
		assert.equal(response.status, 502)
		assert.doesNotMatch(await response.text(), /provider secret detail/)
		assert.equal((await repository.getAccountSummary(account.id))?.balanceMicros, 100_000_000n)
	})

	it("times out an unresponsive provider and refunds the reservation", async () => {
		const mockFetch = ((_input, init) =>
			new Promise<Response>((_resolve, reject) => {
				const signal = init?.signal
				if (!signal) throw new Error("Expected an upstream abort signal")
				signal.addEventListener("abort", () => reject(signal.reason), { once: true })
			})) satisfies GatewayFetch
		const { app, repository, account, headers } = await setup(mockFetch)
		const response = await app.request("/v1/chat/completions", {
			method: "POST",
			headers,
			body: JSON.stringify({
				model: "palot-deepseek-chat",
				messages: [{ role: "user", content: "test timeout" }],
				max_tokens: 10,
			}),
		})
		assert.equal(response.status, 504)
		assert.equal((await response.json()).error.code, "upstream_timeout")
		assert.equal((await repository.getAccountSummary(account.id))?.balanceMicros, 100_000_000n)
	})

	it("returns a billing error before contacting the provider", async () => {
		let called = false
		const mockFetch = (async () => {
			called = true
			return Response.json({})
		}) satisfies GatewayFetch
		const { app, headers } = await setup(mockFetch, 0n)
		const response = await app.request("/v1/chat/completions", {
			method: "POST",
			headers,
			body: JSON.stringify({
				model: "palot-deepseek-chat",
				messages: [{ role: "user", content: "test" }],
			}),
		})
		assert.equal(response.status, 402)
		assert.equal(called, false)
	})

	it("inspects streaming usage and settles before closing the response", async () => {
		const encoder = new TextEncoder()
		const mockFetch = (async () => {
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(
						encoder.encode(
							'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n' +
								'data: {"choices":[],"usage":{"prompt_tokens":80,"completion_tokens":20}}\n\n' +
								"data: [DONE]\n\n",
						),
					)
					controller.close()
				},
			})
			return new Response(stream, { headers: { "content-type": "text/event-stream" } })
		}) satisfies GatewayFetch
		const { app, repository, account, headers } = await setup(mockFetch)
		const response = await app.request("/v1/chat/completions", {
			method: "POST",
			headers,
			body: JSON.stringify({
				model: "palot-deepseek-chat",
				messages: [{ role: "user", content: "stream" }],
				stream: true,
			}),
		})
		assert.match(await response.text(), /hello/)
		const summary = await repository.getAccountSummary(account.id)
		assert.equal(summary?.recentUsage[0]?.state, "settled")
		assert.equal(summary?.recentUsage[0]?.usage?.source, "provider")
	})

	it("uses a sanitized estimate when a stream omits provider usage", async () => {
		const mockFetch = (async () =>
			new Response('data: {"choices":[{"delta":{"content":"estimated"}}]}\n\ndata: [DONE]\n\n', {
				headers: { "content-type": "text/event-stream" },
			})) satisfies GatewayFetch
		const { app, repository, account, headers } = await setup(mockFetch)
		const response = await app.request("/v1/chat/completions", {
			method: "POST",
			headers,
			body: JSON.stringify({
				model: "palot-deepseek-chat",
				messages: [{ role: "user", content: "stream" }],
				stream: true,
			}),
		})
		await response.text()
		const usage = (await repository.getAccountSummary(account.id))?.recentUsage[0]?.usage
		assert.equal(usage?.source, "estimated")
		assert.ok((usage?.outputTokens ?? 0) > 0)
	})

	it("creates and completes a sandbox top-up without trusting the client return page", async () => {
		const sandboxConfig: GatewayConfig = {
			...config,
			paymentMode: "sandbox",
			publicUrl: "https://cloud.example.test",
		}
		const repository = new MemoryGatewayRepository(sandboxConfig.tokenPepper)
		const account = await repository.createAccount("Top-up user")
		const token = await repository.createToken(account.id)
		const app = createGatewayApp({ repository, config: sandboxConfig, fetch })
		const headers = {
			authorization: `Bearer ${token.rawToken}`,
			"content-type": "application/json",
			"idempotency-key": "topup-test-1",
		}
		const packages = await app.request("/v1/topups/packages", { headers })
		assert.equal(packages.status, 200)
		assert.equal(((await packages.json()) as { available: boolean }).available, true)
		const created = await app.request("/v1/topups/orders", {
			method: "POST",
			headers,
			body: JSON.stringify({ packageId: "credits-10" }),
		})
		assert.equal(created.status, 200)
		const order = (await created.json()) as { id: string; checkoutUrl: string; state: string }
		assert.equal(order.state, "pending")
		assert.equal((await repository.getAccountSummary(account.id))?.balanceMicros, 0n)

		const checkoutUrl = new URL(order.checkoutUrl)
		const checkout = await app.request(`${checkoutUrl.pathname}${checkoutUrl.search}`)
		assert.equal(checkout.status, 200)
		const tokenValue = checkoutUrl.searchParams.get("token")
		const completed = await app.request("/payments/sandbox/complete", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ orderId: order.id, token: tokenValue ?? "" }),
		})
		assert.equal(completed.status, 200)
		assert.equal((await repository.getAccountSummary(account.id))?.balanceMicros, 10_000_000n)

		const duplicate = await app.request("/payments/sandbox/complete", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ orderId: order.id, token: tokenValue ?? "" }),
		})
		assert.equal(duplicate.status, 200)
		assert.equal((await repository.getAccountSummary(account.id))?.balanceMicros, 10_000_000n)
	})

	it("blocks new top-ups after an accounting audit failure without abandoning open orders", async () => {
		const sandboxConfig: GatewayConfig = {
			...config,
			paymentMode: "sandbox",
			publicUrl: "https://cloud.example.test",
		}
		const repository = new MemoryGatewayRepository(sandboxConfig.tokenPepper)
		const account = await repository.createAccount("Audit guard user")
		const token = await repository.createToken(account.id)
		let accountingHealthy = true
		const app = createGatewayApp({
			repository,
			config: sandboxConfig,
			fetch,
			paymentAccountingHealthy: () => accountingHealthy,
		})
		const headers = {
			authorization: `Bearer ${token.rawToken}`,
			"content-type": "application/json",
			"idempotency-key": "topup-before-audit",
		}
		const created = await app.request("/v1/topups/orders", {
			method: "POST",
			headers,
			body: JSON.stringify({ packageId: "credits-10" }),
		})
		assert.equal(created.status, 200)
		const order = (await created.json()) as { id: string; checkoutUrl: string }

		accountingHealthy = false
		const packages = await app.request("/v1/topups/packages", { headers })
		assert.deepEqual(await packages.json(), {
			available: false,
			channel: null,
			data: [
				{
					id: "credits-10",
					label: "CNY 10",
					amountMicros: "10000000",
					creditMicros: "10000000",
					currency: "CNY",
				},
				{
					id: "credits-30",
					label: "CNY 30",
					amountMicros: "30000000",
					creditMicros: "30000000",
					currency: "CNY",
				},
				{
					id: "credits-100",
					label: "CNY 100",
					amountMicros: "100000000",
					creditMicros: "100000000",
					currency: "CNY",
				},
			],
		})
		const blocked = await app.request("/v1/topups/orders", {
			method: "POST",
			headers: { ...headers, "idempotency-key": "topup-after-audit" },
			body: JSON.stringify({ packageId: "credits-10" }),
		})
		assert.equal(blocked.status, 503)
		assert.equal((await blocked.json()).error.code, "payments_unavailable")

		const checkoutUrl = new URL(order.checkoutUrl)
		const completed = await app.request("/payments/sandbox/complete", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				orderId: order.id,
				token: checkoutUrl.searchParams.get("token") ?? "",
			}),
		})
		assert.equal(completed.status, 200)
		assert.equal((await repository.getAccountSummary(account.id))?.balanceMicros, 10_000_000n)
	})
})
