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
		assert.equal(upstreamModel, "deepseek-chat")
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
})
