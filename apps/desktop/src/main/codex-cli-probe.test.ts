import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { probeOfficialCodexCli, type CodexCommandRunner } from "./codex-cli-probe.ts"

const codexPath = "C:\\audit\\codex.exe"

function options(includeRuntime: boolean) {
	return {
		isPackaged: false,
		platform: "win32" as const,
		arch: "x64",
		environment: includeRuntime ? { PATH: "", PALOT_TEST_CODEX_PATH: codexPath } : { PATH: "" },
		fileExists: (candidate: string) => includeRuntime && candidate === codexPath,
	}
}

describe("official Codex CLI probe", () => {
	it("keeps the future engine disabled when no verified runtime exists", async () => {
		const descriptor = await probeOfficialCodexCli(options(false))

		assert.equal(descriptor.availability, "unavailable")
		assert.equal(descriptor.enabled, false)
		assert.equal(descriptor.transport, undefined)
	})

	it("detects a structured app-server without enabling it", async () => {
		const calls: string[][] = []
		const runner: CodexCommandRunner = async (_filePath, args) => {
			calls.push(args)
			return {
				ok: true,
				stdout: args[0] === "--version" ? "codex-cli 0.146.0" : "app-server options",
				stderr: "",
			}
		}
		const descriptor = await probeOfficialCodexCli(options(true), runner)

		assert.equal(descriptor.availability, "available")
		assert.equal(descriptor.enabled, false)
		assert.equal(descriptor.version, "0.146.0")
		assert.equal(descriptor.transport, "app-server")
		assert.deepEqual(calls, [["--version"], ["app-server", "--help"]])
	})

	it("rejects CLIs without the required structured interface", async () => {
		const runner: CodexCommandRunner = async (_filePath, args) => ({
			ok: args[0] === "--version",
			stdout: args[0] === "--version" ? "codex-cli 0.146.0" : "",
			stderr: args[0] === "--version" ? "" : "unknown command",
		})
		const descriptor = await probeOfficialCodexCli(options(true), runner)

		assert.equal(descriptor.availability, "incompatible")
		assert.match(descriptor.reason ?? "", /app-server/)
	})

	it("isolates command launch failures from the engine registry", async () => {
		const runner: CodexCommandRunner = async () => {
			throw new Error("spawn EINVAL")
		}
		const descriptor = await probeOfficialCodexCli(options(true), runner)

		assert.equal(descriptor.availability, "incompatible")
		assert.equal(descriptor.enabled, false)
		assert.match(descriptor.reason ?? "", /could not be executed/)
	})
})
