const { mkdir, mkdtemp, rm, writeFile } = require("node:fs/promises")
const { tmpdir } = require("node:os")
const path = require("node:path")
const { afterEach, describe, expect, it } = require("bun:test")
const { createPackage } = require("@electron/asar")
const { scanWindowsPackage } = require("./scan-windows-package.cjs")

const temporaryDirectories = []

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
	)
})

async function createFixture(files) {
	const directory = await mkdtemp(path.join(tmpdir(), "palot-package-scan-"))
	temporaryDirectories.push(directory)
	const source = path.join(directory, "source")
	const packageRoot = path.join(directory, "win-unpacked")
	await mkdir(source, { recursive: true })
	await mkdir(path.join(packageRoot, "resources", "runtime"), { recursive: true })
	await writeFile(path.join(packageRoot, "Palot.exe"), "fixture")
	await writeFile(path.join(packageRoot, "resources", "runtime", "runtime-manifest.json"), "{}")
	for (const [name, content] of Object.entries(files)) {
		const destination = path.join(source, name)
		await mkdir(path.dirname(destination), { recursive: true })
		await writeFile(destination, content)
	}
	await createPackage(source, path.join(packageRoot, "resources", "app.asar"))
	return packageRoot
}

describe("scanWindowsPackage", () => {
	it("accepts a package without credentials", async () => {
		const root = await createFixture({ "index.js": 'const endpoint = "https://api.openai.com/v1"' })
		expect(scanWindowsPackage(root)).toEqual([])
	})

	it("reports secret types and paths without returning matched values", async () => {
		const secret = `sk-proj-${"A".repeat(32)}`
		const root = await createFixture({ "index.js": `const key = "${secret}"` })
		const findings = scanWindowsPackage(root)
		expect(findings).toEqual([{ label: "OpenAI API key", file: "app.asar/index.js" }])
		expect(JSON.stringify(findings)).not.toContain(secret)
	})

	it("rejects forbidden credential file names inside app.asar", async () => {
		const root = await createFixture({ "config/auth.json": "{}" })
		expect(scanWindowsPackage(root)).toContainEqual({
			label: "OpenCode credentials",
			file: "app.asar/config/auth.json",
		})
	})

	it("rejects forbidden files outside app.asar", async () => {
		const root = await createFixture({ "index.js": "export {}" })
		await writeFile(path.join(root, "palot.db"), "fixture")
		expect(scanWindowsPackage(root)).toContainEqual({ label: "Palot database", file: "palot.db" })
	})

	it("does not classify dependency fixtures or syntax names as credentials", async () => {
		const root = await createFixture({
			"node_modules/example/fixture.js": 'const token = "eyJfixture.header.signature"',
			"out/renderer/highlighter.js": 'const symbol = "verilog-sk-prompt-sample-name"',
		})
		expect(scanWindowsPackage(root)).toEqual([])
	})

	it("still rejects a high-confidence credential inside a dependency", async () => {
		const root = await createFixture({
			"node_modules/example/index.js": `const key = "sk-proj-${"B".repeat(32)}"`,
		})
		expect(scanWindowsPackage(root)).toContainEqual({
			label: "OpenAI API key",
			file: "app.asar/node_modules/example/index.js",
		})
	})

	it("rejects a directory that is not a packaged application", async () => {
		const directory = await mkdtemp(path.join(tmpdir(), "palot-package-scan-incomplete-"))
		temporaryDirectories.push(directory)
		expect(() => scanWindowsPackage(directory)).toThrow("Required packaged file is missing")
	})
})
