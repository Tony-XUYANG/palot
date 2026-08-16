/**
 * Minimal RSA2 adapter for Alipay computer website payments and refunds.
 */

import { createHash, sign, verify } from "node:crypto"
import type { PaymentNotification, PaymentOrder, PaymentProvider } from "./payments"
import { formatMicrosAsYuan, parseYuanToMicros } from "./pricing"

export interface AlipayConfig {
	appId: string
	sellerId: string
	privateKey: string
	publicKey: string
	gatewayUrl: string
	publicUrl: string
}

const COMMON_PARAMETERS = {
	format: "JSON",
	charset: "utf-8",
	sign_type: "RSA2",
	version: "1.0",
} as const

function canonicalize(parameters: Record<string, string>): string {
	return Object.entries(parameters)
		.filter(([key, value]) => key !== "sign" && key !== "sign_type" && value !== "")
		.toSorted(([left], [right]) => left.localeCompare(right))
		.map(([key, value]) => `${key}=${value}`)
		.join("&")
}

function signParameters(parameters: Record<string, string>, privateKey: string): string {
	return sign("RSA-SHA256", Buffer.from(canonicalize(parameters)), privateKey).toString("base64")
}

function verifyParameters(parameters: Record<string, string>, publicKey: string): boolean {
	const signature = parameters.sign
	if (!signature) return false
	return verify(
		"RSA-SHA256",
		Buffer.from(canonicalize(parameters)),
		publicKey,
		Buffer.from(signature, "base64"),
	)
}

function timestamp(): string {
	const value = new Date()
		.toISOString()
		.replace("T", " ")
		.replace(/\.\d{3}Z$/, "")
	return value
}

function createSignedParameters(
	config: AlipayConfig,
	method: string,
	bizContent: Record<string, unknown>,
	additional: Record<string, string> = {},
): URLSearchParams {
	const parameters: Record<string, string> = {
		...COMMON_PARAMETERS,
		app_id: config.appId,
		method,
		timestamp: timestamp(),
		biz_content: JSON.stringify(bizContent),
		...additional,
	}
	parameters.sign = signParameters(parameters, config.privateKey)
	return new URLSearchParams(parameters)
}

function hashNotification(parameters: Record<string, string>): string {
	return createHash("sha256").update(canonicalize(parameters)).digest("hex")
}

function extractSignedResponse(
	text: string,
	field: string,
): { value: unknown; signedText: string } {
	const marker = `"${field}":`
	const start = text.indexOf(marker)
	if (start < 0) throw new Error("Alipay returned an invalid response")
	let index = start + marker.length
	while (/\s/.test(text[index] ?? "")) index++
	if (text[index] !== "{") throw new Error("Alipay returned an invalid response")
	const valueStart = index
	let depth = 0
	let inString = false
	let escaped = false
	for (; index < text.length; index++) {
		const character = text[index]
		if (inString) {
			if (escaped) escaped = false
			else if (character === "\\") escaped = true
			else if (character === '"') inString = false
			continue
		}
		if (character === '"') inString = true
		else if (character === "{") depth++
		else if (character === "}") {
			depth--
			if (depth === 0) {
				const signedText = text.slice(valueStart, index + 1)
				return { value: JSON.parse(signedText) as unknown, signedText }
			}
		}
	}
	throw new Error("Alipay returned an invalid response")
}

export class AlipayProvider implements PaymentProvider {
	readonly channel = "alipay" as const

	constructor(
		private readonly config: AlipayConfig,
		private readonly request: typeof fetch = fetch,
	) {}

	async createCheckoutUrl(order: PaymentOrder): Promise<string> {
		const parameters = createSignedParameters(
			this.config,
			"alipay.trade.page.pay",
			{
				out_trade_no: order.id,
				product_code: "FAST_INSTANT_TRADE_PAY",
				subject: `Palot AI Credits ${order.packageId}`,
				total_amount: formatMicrosAsYuan(order.amountMicros),
				timeout_express: "15m",
			},
			{
				notify_url: `${this.config.publicUrl}/payments/alipay/notify`,
				return_url: `${this.config.publicUrl}/checkout/return`,
			},
		)
		return `${this.config.gatewayUrl}?${parameters.toString()}`
	}

	verifyNotification(parameters: Record<string, string>): PaymentNotification {
		if (!verifyParameters(parameters, this.config.publicKey)) {
			throw new Error("Alipay notification signature is invalid")
		}
		if (parameters.app_id !== this.config.appId || parameters.seller_id !== this.config.sellerId) {
			throw new Error("Alipay notification merchant does not match")
		}
		if (
			parameters.trade_status !== "TRADE_SUCCESS" &&
			parameters.trade_status !== "TRADE_FINISHED"
		) {
			throw new Error("Alipay notification is not a completed payment")
		}
		const orderId = parameters.out_trade_no
		const providerTradeNo = parameters.trade_no
		const notifyId = parameters.notify_id
		if (!orderId || !providerTradeNo || !notifyId || !parameters.total_amount) {
			throw new Error("Alipay notification is incomplete")
		}
		return {
			providerEventId: notifyId,
			providerTradeNo,
			orderId,
			amountMicros: parseYuanToMicros(parameters.total_amount),
			payloadHash: hashNotification(parameters),
		}
	}

	async queryPayment(order: PaymentOrder): Promise<PaymentNotification | null> {
		const parameters = createSignedParameters(this.config, "alipay.trade.query", {
			out_trade_no: order.id,
		})
		const response = await this.request(this.config.gatewayUrl, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded;charset=utf-8" },
			body: parameters,
			signal: AbortSignal.timeout(30_000),
		})
		if (!response.ok) throw new Error("Alipay payment query failed")
		const text = await response.text()
		const extracted = extractSignedResponse(text, "alipay_trade_query_response")
		const envelope = JSON.parse(text) as { sign?: unknown }
		if (
			typeof envelope.sign !== "string" ||
			!verify(
				"RSA-SHA256",
				Buffer.from(extracted.signedText),
				this.config.publicKey,
				Buffer.from(envelope.sign, "base64"),
			)
		) {
			throw new Error("Alipay payment query signature is invalid")
		}
		const value = extracted.value as {
			code?: unknown
			sub_code?: unknown
			out_trade_no?: unknown
			trade_no?: unknown
			trade_status?: unknown
			total_amount?: unknown
		}
		if (value.code === "40004" && value.sub_code === "ACQ.TRADE_NOT_EXIST") return null
		if (value.code !== "10000") throw new Error("Alipay payment query was rejected")
		if (value.trade_status !== "TRADE_SUCCESS" && value.trade_status !== "TRADE_FINISHED") {
			return null
		}
		if (
			value.out_trade_no !== order.id ||
			typeof value.trade_no !== "string" ||
			typeof value.total_amount !== "string"
		) {
			throw new Error("Alipay payment query does not match the order")
		}
		return {
			providerEventId: `query:${value.trade_no}:${value.trade_status}`,
			providerTradeNo: value.trade_no,
			orderId: order.id,
			amountMicros: parseYuanToMicros(value.total_amount),
			payloadHash: createHash("sha256").update(extracted.signedText).digest("hex"),
		}
	}

	async refund(order: PaymentOrder): Promise<{ providerRefundNo: string }> {
		const providerRefundNo = `refund-${order.id}`
		const parameters = createSignedParameters(this.config, "alipay.trade.refund", {
			out_trade_no: order.id,
			refund_amount: formatMicrosAsYuan(order.amountMicros),
			out_request_no: providerRefundNo,
			refund_reason: "Palot AI credit refund",
		})
		const response = await this.request(this.config.gatewayUrl, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded;charset=utf-8" },
			body: parameters,
			signal: AbortSignal.timeout(30_000),
		})
		if (!response.ok) throw new Error("Alipay refund request failed")
		const text = await response.text()
		const extracted = extractSignedResponse(text, "alipay_trade_refund_response")
		const envelope = JSON.parse(text) as { sign?: unknown }
		if (
			typeof envelope.sign !== "string" ||
			!verify(
				"RSA-SHA256",
				Buffer.from(extracted.signedText),
				this.config.publicKey,
				Buffer.from(envelope.sign, "base64"),
			)
		) {
			throw new Error("Alipay refund response signature is invalid")
		}
		const value = extracted.value as { code?: unknown; refund_fee?: unknown }
		if (value.code !== "10000" || value.refund_fee !== formatMicrosAsYuan(order.amountMicros)) {
			throw new Error("Alipay did not confirm the refund")
		}
		return { providerRefundNo }
	}
}

export const alipaySignatureInternals = {
	canonicalize,
	signParameters,
	verifyParameters,
	extractSignedResponse,
}
