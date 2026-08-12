/**
 * Verifies that an electron-updater Windows manifest describes the exact installer being released.
 */

const { createHash } = require("node:crypto")
const { createReadStream, existsSync, readFileSync, statSync } = require("node:fs")
const path = require("node:path")
const { parse } = require("yaml")

function requireString(value, label) {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${label} must be a non-empty string`)
	}
	return value
}

function parseArguments(args) {
	const values = {}
	for (let index = 0; index < args.length; index += 2) {
		const flag = args[index]
		const value = args[index + 1]
		if (!flag?.startsWith("--") || value === undefined) {
			throw new Error(`Invalid argument sequence near ${flag ?? "the end of the command"}`)
		}
		values[flag.slice(2)] = value
	}

	return {
		manifestPath: requireString(values.manifest, "--manifest"),
		installerPath: requireString(values.installer, "--installer"),
		expectedVersion: requireString(values.version, "--version"),
	}
}

function calculateSha512(file) {
	return new Promise((resolve, reject) => {
		const hash = createHash("sha512")
		const stream = createReadStream(file)
		stream.on("error", reject)
		stream.on("data", (chunk) => hash.update(chunk))
		stream.on("end", () => resolve(hash.digest("base64")))
	})
}

async function verifyWindowsUpdateManifest({
	manifestPath,
	installerPath,
	expectedVersion,
}) {
	const resolvedManifest = path.resolve(manifestPath)
	const resolvedInstaller = path.resolve(installerPath)
	if (!existsSync(resolvedManifest)) {
		throw new Error(`Update manifest is missing: ${resolvedManifest}`)
	}
	if (!existsSync(resolvedInstaller)) {
		throw new Error(`Windows installer is missing: ${resolvedInstaller}`)
	}

	const manifest = parse(readFileSync(resolvedManifest, "utf8"))
	if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
		throw new Error("Update manifest must contain a YAML object")
	}
	if (manifest.version !== expectedVersion) {
		throw new Error(
			`Update manifest version mismatch: expected ${expectedVersion}, received ${manifest.version}`,
		)
	}

	const installerName = path.basename(resolvedInstaller)
	if (manifest.path !== installerName) {
		throw new Error(`Update manifest path must be exactly ${installerName}`)
	}
	if (!Array.isArray(manifest.files)) throw new Error("Update manifest files must be an array")
	const installerEntries = manifest.files.filter((entry) => entry?.url === installerName)
	if (installerEntries.length !== 1) {
		throw new Error(`Update manifest must contain exactly one file entry for ${installerName}`)
	}

	const installerEntry = installerEntries[0]
	const installerSize = statSync(resolvedInstaller).size
	if (installerEntry.size !== installerSize) {
		throw new Error(
			`Update manifest size mismatch: expected ${installerSize}, received ${installerEntry.size}`,
		)
	}

	const sha512 = await calculateSha512(resolvedInstaller)
	if (installerEntry.sha512 !== sha512) {
		throw new Error("Update manifest file SHA-512 does not match the Windows installer")
	}
	if (manifest.sha512 !== sha512) {
		throw new Error("Update manifest top-level SHA-512 does not match the Windows installer")
	}

	const releaseDate = Date.parse(manifest.releaseDate)
	if (!Number.isFinite(releaseDate)) throw new Error("Update manifest releaseDate is invalid")

	return {
		version: expectedVersion,
		installerName,
		installerSize,
		sha512,
		releaseDate: new Date(releaseDate).toISOString(),
	}
}

async function main() {
	const result = await verifyWindowsUpdateManifest(parseArguments(process.argv.slice(2)))
	console.log(
		`Windows update manifest passed: ${result.version}, ${result.installerName}, ${result.installerSize} bytes`,
	)
}

if (require.main === module) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error))
		process.exitCode = 1
	})
}

module.exports = {
	calculateSha512,
	parseArguments,
	verifyWindowsUpdateManifest,
}
