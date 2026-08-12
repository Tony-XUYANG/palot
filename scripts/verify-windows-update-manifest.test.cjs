const { createHash } = require("node:crypto")
const { mkdtemp, rm, writeFile } = require("node:fs/promises")
const { tmpdir } = require("node:os")
const path = require("node:path")
const { afterEach, describe, expect, it } = require("bun:test")
const { stringify } = require("yaml")
const { verifyWindowsUpdateManifest } = require("./verify-windows-update-manifest.cjs")

const temporaryDirectories = []

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
	)
})

async function createFixture(overrides = {}) {
	const directory = await mkdtemp(path.join(tmpdir(), "palot-update-manifest-"))
	temporaryDirectories.push(directory)
	const installerName = "Palot-1.2.3-win-x64.exe"
	const installerPath = path.join(directory, installerName)
	const manifestPath = path.join(directory, "latest.yml")
	const installer = Buffer.from("deterministic installer fixture")
	const sha512 = createHash("sha512").update(installer).digest("base64")
	await writeFile(installerPath, installer)
	await writeFile(
		manifestPath,
		stringify({
			version: "1.2.3",
			files: [{ url: installerName, sha512, size: installer.length }],
			path: installerName,
			sha512,
			releaseDate: "2026-08-12T00:00:00.000Z",
			...overrides,
		}),
	)
	return { installerPath, manifestPath }
}

describe("verifyWindowsUpdateManifest", () => {
	it("accepts an exact installer manifest", async () => {
		const fixture = await createFixture()
		const result = await verifyWindowsUpdateManifest({
			...fixture,
			expectedVersion: "1.2.3",
		})
		expect(result.version).toBe("1.2.3")
		expect(result.installerSize).toBe(31)
	})

	it("rejects a different version", async () => {
		const fixture = await createFixture({ version: "1.2.4" })
		await expect(
			verifyWindowsUpdateManifest({ ...fixture, expectedVersion: "1.2.3" }),
		).rejects.toThrow("version mismatch")
	})

	it("rejects a different installer size", async () => {
		const fixture = await createFixture({
			files: [
				{
					url: "Palot-1.2.3-win-x64.exe",
					sha512: createHash("sha512")
						.update("deterministic installer fixture")
						.digest("base64"),
					size: 1,
				},
			],
		})
		await expect(
			verifyWindowsUpdateManifest({ ...fixture, expectedVersion: "1.2.3" }),
		).rejects.toThrow("size mismatch")
	})

	it("rejects a different SHA-512", async () => {
		const fixture = await createFixture({ sha512: "invalid" })
		await expect(
			verifyWindowsUpdateManifest({ ...fixture, expectedVersion: "1.2.3" }),
		).rejects.toThrow("top-level SHA-512")
	})
})
