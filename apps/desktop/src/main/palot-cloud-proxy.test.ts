import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { startPalotCloudProxy, type PalotCloudProxyFetch } from "./palot-cloud-proxy.ts"

describe("Palot Cloud loopback proxy", () => {
	it("replaces the local session token and forwards streaming responses", async () => {
		let authorization = ""
		let idempotencyKey = ""
		const requestFetch = (async (_input, init) => {
			const headers = new Headers(init?.headers)
			authorization = headers.get("authorization") ?? ""
			idempotencyKey = headers.get("idempotency-key") ?? ""
			return new Response('data: {"choices":[]}\n\ndata: [DONE]\n\n', {
				headers: { "content-type": "text/event-stream" },
			})
		}) satisfies PalotCloudProxyFetch
		const proxy = await startPalotCloudProxy({
			gatewayUrl: "https://cloud.example.test",
			cloudToken: "palot-long-lived-token",
			fetch: requestFetch,
		})
		try {
			assert.equal((await fetch(`${proxy.baseUrl}/models`)).status, 401)
			const response = await fetch(`${proxy.baseUrl}/chat/completions`, {
				method: "POST",
				headers: {
					authorization: `Bearer ${proxy.sessionToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ model: "palot-deepseek-chat", messages: [] }),
			})
			assert.equal(response.status, 200)
			assert.match(await response.text(), /DONE/)
			assert.equal(authorization, "Bearer palot-long-lived-token")
			assert.match(idempotencyKey, /^[0-9a-f-]{36}$/)
		} finally {
			await proxy.close()
		}
	})

	it("rejects unallowlisted paths before cloud access", async () => {
		let calls = 0
		const proxy = await startPalotCloudProxy({
			gatewayUrl: "https://cloud.example.test",
			cloudToken: "palot-long-lived-token",
			fetch: async () => {
				calls++
				return new Response()
			},
		})
		try {
			const response = await fetch(`${proxy.baseUrl}/admin`, {
				headers: { authorization: `Bearer ${proxy.sessionToken}` },
			})
			assert.equal(response.status, 404)
			assert.equal(calls, 0)
		} finally {
			await proxy.close()
		}
	})
})
