import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { GlobalEvent, OpencodeClient, Session } from "@opencode-ai/sdk/v2/client"
import { createOpenCodeAgentEngine } from "./opencode-agent-engine.ts"

describe("OpenCode agent engine", () => {
	it("delegates the shared lifecycle and session contract to the v2 SDK", async () => {
		let serverUrl: string | null = null
		let stopped = false
		const promptInputs: Array<Record<string, unknown>> = []
		let abortedSession = ""
		const session = {
			id: "session-1",
			title: "Acceptance",
			directory: "C:\\project",
			time: { created: 1, updated: 2 },
		} as Session
		const eventStream = {
			async *[Symbol.asyncIterator]() {
				yield { directory: "C:\\project", payload: { type: "server.connected" } }
			},
		} as AsyncIterable<GlobalEvent>
		const client = {
			provider: {
				list: async () => ({ data: { connected: ["deepseek", "openai"] } }),
			},
			session: {
				create: async () => ({ data: session }),
				promptAsync: async (input: Record<string, unknown>) => {
					promptInputs.push(input)
				},
				abort: async ({ sessionID }: { sessionID: string }) => {
					abortedSession = sessionID
				},
				diff: async () => ({ data: [] }),
			},
			global: {
				event: async () => ({ stream: eventStream }),
			},
		} as unknown as OpencodeClient
		const engine = createOpenCodeAgentEngine({
			inspect: async () => ({
				id: "opencode",
				label: "OpenCode",
				availability: "available",
				enabled: true,
				capabilities: {
					auth: true,
					sessions: true,
					prompts: true,
					events: true,
					cancel: true,
					diff: true,
				},
			}),
			ensureServer: async () => {
				serverUrl = "http://127.0.0.1:4101"
				return { url: serverUrl }
			},
			getServerUrl: () => serverUrl,
			stopServer: () => {
				stopped = true
				return true
			},
			createClient: () => client,
		})

		assert.equal((await engine.start()).endpoint, serverUrl)
		assert.deepEqual(await engine.authStatus("C:\\project"), {
			state: "connected",
			providerIDs: ["deepseek", "openai"],
		})
		assert.deepEqual(await engine.createSession("C:\\project", "Acceptance"), {
			id: "session-1",
			title: "Acceptance",
			directory: "C:\\project",
			createdAt: 1,
			updatedAt: 2,
		})
		await engine.prompt({
			directory: "C:\\project",
			sessionID: session.id,
			parts: [{ type: "text", text: "Run the tests" }],
			model: { providerID: "deepseek", modelID: "deepseek-chat" },
		})
		assert.deepEqual(promptInputs[0]?.model, {
			providerID: "deepseek",
			modelID: "deepseek-chat",
		})
		await engine.cancel("C:\\project", session.id)
		assert.equal(abortedSession, session.id)
		assert.deepEqual(await engine.diff("C:\\project", session.id), [])
		const events = await engine.events()
		const firstEvent = await events[Symbol.asyncIterator]().next()
		assert.deepEqual(firstEvent.value, {
			type: "server.connected",
			payload: { type: "server.connected" },
			directory: "C:\\project",
			sessionID: undefined,
		})
		assert.equal(await engine.stop(), true)
		assert.equal(stopped, true)
	})
})
