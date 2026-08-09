import assert from "node:assert/strict"
import type { ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import { describe, it } from "node:test"
import { createCodexAgentEngine, parseCodexUnifiedDiff } from "./codex-agent-engine.ts"

interface RecordedRequest {
	id: number
	method: string
	params: Record<string, unknown>
}

function responseFor(method: string): unknown {
	switch (method) {
		case "initialize":
			return {
				codexHome: "C:\\PalotData\\codex",
				platformFamily: "windows",
				platformOs: "windows",
				userAgent: "codex_cli_rs/0.146.0",
			}
		case "account/read":
			return { account: { type: "chatgpt", planType: "plus" }, requiresOpenaiAuth: true }
		case "account/login/start":
			return { type: "chatgpt", authUrl: "https://auth.example.test", loginId: "login-1" }
		case "model/list":
			return {
				data: [
					{
						id: "gpt-codex",
						model: "gpt-codex",
						displayName: "Codex",
						description: "Coding model",
						hidden: false,
						isDefault: true,
					},
				],
				nextCursor: null,
			}
		case "thread/start":
			return {
				thread: {
					id: "thread-1",
					cwd: "C:\\project",
					createdAt: 10,
					updatedAt: 11,
					name: null,
				},
			}
		case "turn/start":
			return { turn: { id: "turn-1", status: "inProgress" } }
		case "turn/interrupt":
			return {}
		default:
			throw new Error(`Unexpected method: ${method}`)
	}
}

function createMockServer() {
	const requests: RecordedRequest[] = []
	const stdin = new PassThrough()
	const stdout = new PassThrough()
	const stderr = new PassThrough()
	const emitter = new EventEmitter()
	let killed = false
	let buffer = ""
	stdin.setEncoding("utf8")
	stdin.on("data", (chunk: string) => {
		buffer += chunk
		for (;;) {
			const newline = buffer.indexOf("\n")
			if (newline < 0) break
			const request = JSON.parse(buffer.slice(0, newline)) as RecordedRequest
			buffer = buffer.slice(newline + 1)
			requests.push(request)
			stdout.write(`${JSON.stringify({ id: request.id, result: responseFor(request.method) })}\n`)
		}
	})
	const child = Object.assign(emitter, {
		stdin,
		stdout,
		stderr,
		kill: () => {
			killed = true
			return true
		},
	}) as unknown as ChildProcessWithoutNullStreams
	return {
		child,
		requests,
		stdout,
		get killed() {
			return killed
		},
	}
}

describe("official Codex app-server preview", () => {
	it("maps auth, models, sessions, prompts, diff events, and cancellation", async () => {
		const server = createMockServer()
		let spawnArgs: string[] = []
		let spawnEnvironment: NodeJS.ProcessEnv | undefined
		const spawnProcess = ((_file: string, args: readonly string[], options: { env?: NodeJS.ProcessEnv }) => {
			spawnArgs = [...args]
			spawnEnvironment = options.env
			return server.child
		}) as typeof spawn
		const engine = createCodexAgentEngine({
			runtimePath: "C:\\runtime\\codex.exe",
			codexHome: "C:\\PalotData\\codex",
			inspect: async () => ({
				id: "codex",
				label: "Official Codex CLI",
				availability: "available",
				enabled: false,
				capabilities: {
					auth: true,
					sessions: true,
					prompts: true,
					events: true,
					cancel: true,
					diff: true,
				},
			}),
			spawnProcess,
			environment: { PATH: "" },
		})

		assert.equal((await engine.start()).transport, "app-server")
		assert.deepEqual(spawnArgs, ["app-server", "--listen", "stdio://", "--strict-config"])
		assert.equal(spawnEnvironment?.CODEX_HOME, "C:\\PalotData\\codex")
		assert.deepEqual(await engine.authStatus(), {
			state: "connected",
			providerIDs: ["openai"],
		})
		assert.deepEqual(await engine.beginLogin(), {
			type: "browser",
			url: "https://auth.example.test",
			loginID: "login-1",
		})
		assert.equal((await engine.listModels())[0]?.id, "gpt-codex")
		const session = await engine.createSession("C:\\project", "Preview")
		assert.equal(session.id, "thread-1")
		assert.equal(session.title, "Preview")

		await engine.prompt({
			directory: "C:\\project",
			sessionID: session.id,
			parts: [{ type: "text", text: "Update the health endpoint" }],
			model: { providerID: "openai", modelID: "gpt-codex" },
		})
		const turnRequest = server.requests.find((request) => request.method === "turn/start")
		assert.equal(turnRequest?.params.approvalPolicy, "never")
		assert.equal(turnRequest?.params.model, "gpt-codex")

		const events = await engine.events()
		server.stdout.write(
			`${JSON.stringify({
				method: "turn/diff/updated",
				params: {
					threadId: session.id,
					turnId: "turn-1",
					diff: "diff --git a/health.ts b/health.ts\n--- a/health.ts\n+++ b/health.ts\n-old\n+new",
				},
			})}\n`,
		)
		const event = await events[Symbol.asyncIterator]().next()
		assert.equal(event.value?.type, "turn/diff/updated")
		assert.equal((await engine.diff("C:\\project", session.id))[0]?.file, "health.ts")
		await engine.cancel("C:\\project", session.id)
		assert.equal(server.requests.at(-1)?.method, "turn/interrupt")
		assert.equal(await engine.stop(), true)
		assert.equal(server.killed, true)
	})

	it("parses multi-file unified diffs without source snapshots", () => {
		const diffs = parseCodexUnifiedDiff(
			"diff --git a/a.ts b/a.ts\nnew file mode 100644\n--- /dev/null\n+++ b/a.ts\n+one\n" +
				"diff --git a/b.ts b/b.ts\ndeleted file mode 100644\n--- a/b.ts\n+++ /dev/null\n-two\n",
		)
		assert.deepEqual(
			diffs.map((diff) => [diff.file, diff.status, diff.additions, diff.deletions]),
			[
				["a.ts", "added", 1, 0],
				["b.ts", "deleted", 0, 1],
			],
		)
	})

	it("starts a fresh app-server after an unexpected process exit", async () => {
		const servers = [createMockServer(), createMockServer()]
		let spawnCount = 0
		const spawnProcess = (() => servers[spawnCount++].child) as unknown as typeof spawn
		const engine = createCodexAgentEngine({
			runtimePath: "C:\\runtime\\codex.exe",
			codexHome: "C:\\PalotData\\codex",
			inspect: async () => ({
				id: "codex",
				label: "Official Codex CLI",
				availability: "available",
				enabled: false,
				capabilities: {
					auth: true,
					sessions: true,
					prompts: true,
					events: true,
					cancel: true,
					diff: true,
				},
			}),
			spawnProcess,
		})

		await engine.start()
		servers[0].child.emit("exit", 1, null)
		await new Promise((resolve) => setImmediate(resolve))
		await engine.start()

		assert.equal(spawnCount, 2)
		assert.equal(servers[0].requests[0]?.method, "initialize")
		assert.equal(servers[1].requests[0]?.method, "initialize")
	})
})
