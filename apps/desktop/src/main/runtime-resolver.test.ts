import assert from "node:assert/strict"
import path from "node:path"
import { describe, it } from "node:test"
import {
	resolveCodexRuntime,
	resolveGitHubRuntime,
	resolveGitRuntime,
	resolveKubectlRuntime,
	resolveOpenCodeRuntime,
} from "./runtime-resolver.ts"

const resourcesPath = "C:\\Program Files\\Palot\\resources"
const homeDirectory = "C:\\Users\\tester"

function createOptions(files: string[], overrides: Record<string, string> = {}) {
	const normalized = new Set(files.map((file) => path.win32.normalize(file).toLowerCase()))
	return {
		isPackaged: false,
		resourcesPath,
		platform: "win32" as const,
		arch: "x64",
		homeDirectory,
		environment: { PATH: "C:\\tools", ...overrides },
		fileExists: (candidate: string) =>
			normalized.has(path.win32.normalize(candidate).toLowerCase()),
	}
}

describe("runtime resolver", () => {
	it("prefers an explicit test override", () => {
		const override = "C:\\override\\opencode.exe"
		const bundled = path.win32.join(resourcesPath, "runtime", "opencode", "opencode.exe")
		const result = resolveOpenCodeRuntime({
			...createOptions([override, bundled], { PALOT_TEST_OPENCODE_PATH: override }),
			isPackaged: true,
		})
		assert.deepEqual(result, { kind: "opencode", path: override, source: "override" })
	})

	it("uses the bundled runtime in a packaged Windows x64 app", () => {
		const bundled = path.win32.join(resourcesPath, "runtime", "opencode", "opencode.exe")
		const user = path.win32.join(homeDirectory, ".opencode", "bin", "opencode.exe")
		const result = resolveOpenCodeRuntime({
			...createOptions([bundled, user]),
			isPackaged: true,
		})
		assert.equal(result?.path, bundled)
		assert.equal(result?.source, "bundled")
	})

	it("keeps a future packaged Codex runtime isolated from PATH fallbacks", () => {
		const bundled = path.win32.join(resourcesPath, "runtime", "codex", "codex.exe")
		const onPath = "C:\\tools\\codex.exe"
		const available = resolveCodexRuntime({
			...createOptions([bundled, onPath]),
			isPackaged: true,
		})
		const damaged = resolveCodexRuntime({
			...createOptions([onPath]),
			isPackaged: true,
		})

		assert.deepEqual(available, { kind: "codex", path: bundled, source: "bundled" })
		assert.equal(damaged, null)
	})

	it("allows an explicit Codex probe override in development", () => {
		const override = "C:\\audit\\codex.exe"
		const result = resolveCodexRuntime(
			createOptions([override], { PALOT_TEST_CODEX_PATH: override }),
		)

		assert.deepEqual(result, { kind: "codex", path: override, source: "override" })
	})

	it("reports a missing bundled runtime instead of masking a damaged install", () => {
		const user = path.win32.join(homeDirectory, ".opencode", "bin", "opencode.exe")
		const result = resolveOpenCodeRuntime({ ...createOptions([user]), isPackaged: true })
		assert.equal(result, null)
	})

	it("prefers a legacy user runtime over PATH in development", () => {
		const user = path.win32.join(
			homeDirectory,
			".local",
			"share",
			"palot",
			"tools",
			"mingit-2.55.0.3",
			"cmd",
			"git.exe",
		)
		const onPath = "C:\\tools\\git.exe"
		const result = resolveGitRuntime(createOptions([user, onPath]))
		assert.equal(result?.path, user)
		assert.equal(result?.source, "user")
	})

	it("resolves an absolute system PATH binary", () => {
		const onPath = "C:\\tools\\git.exe"
		const result = resolveGitRuntime(createOptions([onPath]))
		assert.equal(result?.path, onPath)
		assert.equal(result?.source, "path")
	})

	it("uses the bundled GitHub CLI in a packaged Windows x64 app", () => {
		const bundled = path.win32.join(resourcesPath, "runtime", "github", "bin", "gh.exe")
		const result = resolveGitHubRuntime({
			...createOptions([bundled]),
			isPackaged: true,
		})
		assert.deepEqual(result, { kind: "github", path: bundled, source: "bundled" })
	})

	it("uses bundled kubectl without relying on PATH", () => {
		const bundled = path.win32.join(resourcesPath, "runtime", "kubectl", "kubectl.exe")
		const result = resolveKubectlRuntime({
			...createOptions([bundled]),
			isPackaged: true,
		})
		assert.deepEqual(result, { kind: "kubectl", path: bundled, source: "bundled" })
	})

	it("does not consider Windows bundled content on another platform", () => {
		const result = resolveOpenCodeRuntime({
			isPackaged: true,
			resourcesPath: "/opt/palot/resources",
			platform: "linux",
			arch: "x64",
			homeDirectory: "/home/tester",
			environment: { PATH: "" },
			fileExists: () => false,
		})
		assert.equal(result, null)
	})
})
