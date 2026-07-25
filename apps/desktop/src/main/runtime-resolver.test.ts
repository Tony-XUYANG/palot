import assert from "node:assert/strict"
import { describe, it } from "node:test"
import path from "node:path"
import { resolveGitRuntime, resolveOpenCodeRuntime } from "./runtime-resolver.ts"

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
		fileExists: (candidate: string) => normalized.has(path.win32.normalize(candidate).toLowerCase()),
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
