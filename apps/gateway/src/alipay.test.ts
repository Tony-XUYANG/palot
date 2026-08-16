import assert from "node:assert/strict"
import { generateKeyPairSync, sign } from "node:crypto"
import { describe, it } from "node:test"
import { type AlipayConfig, AlipayProvider, alipaySignatureInternals } from "./alipay"
import type { PaymentOrder } from "./payments"

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 })
const config: AlipayConfig = {
	appId: "2026000000000000",
	sellerId: "2088000000000000",
	privateKey: keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
	publicKey: keys.publicKey.export({ format: "pem", type: "spki" }).toString(),
	gatewayUrl: "https://openapi.alipay.example.test/gateway.do",
	publicUrl: "https://cloud.example.test",
}

const order: PaymentOrder = {
	id: "4c9e3782-a498-45b4-82cc-3f14cecdf5d6",
	accountId: "06cb0783-0001-47df-9717-a0b66536e7ac",
	packageId: "credits-10",
	channel: "alipay",
	state: "credited",
	amountMicros: 10_000_000n,
	creditMicros: 10_000_000n,
	providerTradeNo: "2026081600001",
	providerRefundNo: null,
	createdAt: "2026-08-16T00:00:00.000Z",
	expiresAt: "2026-08-16T00:15:00.000Z",
	paidAt: "2026-08-16T00:01:00.000Z",
	creditedAt: "2026-08-16T00:01:00.000Z",
	refundedAt: null,
}

describe("Alipay RSA2 provider", () => {
	it("creates a signed computer checkout URL", async () => {
		const provider = new AlipayProvider(config)
		const url = new URL(await provider.createCheckoutUrl(order))
		const parameters = Object.fromEntries(url.searchParams)
		assert.equal(parameters.method, "alipay.trade.page.pay")
		assert.equal(parameters.app_id, config.appId)
		assert.equal(alipaySignatureInternals.verifyParameters(parameters, config.publicKey), true)
		assert.match(parameters.biz_content, /"total_amount":"10"/)
	})

	it("verifies completed notifications and rejects merchant tampering", () => {
		const provider = new AlipayProvider(config)
		const parameters: Record<string, string> = {
			app_id: config.appId,
			seller_id: config.sellerId,
			trade_status: "TRADE_SUCCESS",
			out_trade_no: order.id,
			trade_no: "2026081600001",
			notify_id: "notify-1",
			total_amount: "10.00",
			sign_type: "RSA2",
		}
		parameters.sign = alipaySignatureInternals.signParameters(parameters, config.privateKey)
		const notification = provider.verifyNotification(parameters)
		assert.equal(notification.orderId, order.id)
		assert.equal(notification.amountMicros, 10_000_000n)

		const tampered = { ...parameters, seller_id: "other-seller" }
		assert.throws(() => provider.verifyNotification(tampered), /signature is invalid/)
	})

	it("verifies the signed refund response", async () => {
		const request = (async (_input: string | URL | Request, init?: RequestInit) => {
			const requestParameters = Object.fromEntries(new URLSearchParams(String(init?.body)))
			assert.equal(
				alipaySignatureInternals.verifyParameters(requestParameters, config.publicKey),
				true,
			)
			const responseBody = JSON.stringify({
				code: "10000",
				msg: "Success",
				refund_fee: "10",
			})
			const signature = sign("RSA-SHA256", Buffer.from(responseBody), config.privateKey).toString(
				"base64",
			)
			return new Response(`{"alipay_trade_refund_response":${responseBody},"sign":"${signature}"}`)
		}) as unknown as typeof fetch
		const provider = new AlipayProvider(config, request)
		assert.equal((await provider.refund(order)).providerRefundNo, `refund-${order.id}`)
	})

	it("recovers a completed payment by signed trade query", async () => {
		const request = (async () => {
			const responseBody = JSON.stringify({
				code: "10000",
				msg: "Success",
				out_trade_no: order.id,
				trade_no: "2026081600001",
				trade_status: "TRADE_SUCCESS",
				total_amount: "10.00",
			})
			const signature = sign("RSA-SHA256", Buffer.from(responseBody), config.privateKey).toString(
				"base64",
			)
			return new Response(`{"alipay_trade_query_response":${responseBody},"sign":"${signature}"}`)
		}) as unknown as typeof fetch
		const provider = new AlipayProvider(config, request)
		const notification = await provider.queryPayment({ ...order, state: "pending" })
		assert.equal(notification?.orderId, order.id)
		assert.equal(notification?.amountMicros, 10_000_000n)
		assert.match(notification?.providerEventId ?? "", /^query:/)
	})
})
