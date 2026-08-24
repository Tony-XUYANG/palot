#!/usr/bin/env node

const { parseArgs } = require("node:util")

const SIGNING_MODES = new Set(["", "pfx", "sslcom-esigner"])

function requireEnvironment(name) {
	if (!process.env[name]?.trim()) {
		throw new Error(`Windows signing mode requires ${name}`)
	}
}

function validateWindowsSigningConfig(version) {
	const mode = process.env.WINDOWS_SIGNING_MODE?.trim() ?? ""
	const allowsUnsignedPreview = /-(?:alpha|beta)(?:\.|$)/.test(version)

	if (!SIGNING_MODES.has(mode)) {
		throw new Error(
			`Unsupported WINDOWS_SIGNING_MODE: ${mode}. Expected pfx or sslcom-esigner`,
		)
	}

	if (!mode) {
		if (!allowsUnsignedPreview) {
			throw new Error("Windows RC and stable releases require WINDOWS_SIGNING_MODE")
		}
		return { mode: "unsigned", allowsUnsignedPreview }
	}

	requireEnvironment("WINDOWS_SIGNING_PUBLISHER")
	if (mode === "pfx") {
		requireEnvironment("WINDOWS_CSC_LINK")
	} else {
		requireEnvironment("SSL_COM_USERNAME")
		requireEnvironment("SSL_COM_PASSWORD")
		requireEnvironment("SSL_COM_TOTP_SECRET")
	}

	return { mode, allowsUnsignedPreview }
}

if (require.main === module) {
	const { values } = parseArgs({
		options: {
			version: { type: "string" },
		},
	})
	if (!values.version) {
		throw new Error("Pass --version <desktop-version>")
	}
	const result = validateWindowsSigningConfig(values.version)
	console.log(`Windows signing mode: ${result.mode}`)
}

module.exports = { validateWindowsSigningConfig }
