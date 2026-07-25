/**
 * OpenCode CLI version compatibility definitions for Palot.
 *
 * Updated with each Palot release to reflect tested OpenCode versions.
 * The environment check in the onboarding flow uses these ranges to
 * decide whether to pass, warn, or block.
 */

import { execFile } from "node:child_process"
import { app } from "electron"
import { coerce, satisfies, valid } from "semver"
import { createLogger } from "./logger"
import { resolveOpenCodeRuntime, type RuntimeSource } from "./runtime-resolver"

const log = createLogger("compatibility")

// ============================================================
// Compatibility ranges (standard semver range syntax)
// ============================================================

export const OPENCODE_COMPAT = {
	/** Supported range -- versions that should work. Below this: hard block. */
	supported: ">=1.2.0 <2.0.0",
	/** Tested range -- versions actively tested against. Subset of supported. */
	tested: "~1.18.0",
	/** Known-broken versions. These are hard-blocked with a specific message. */
	blocked: [] as string[],
}

// ============================================================
// Types
// ============================================================

export interface OpenCodeCheckResult {
	installed: boolean
	version: string | null
	path: string | null
	source: "bundled" | "user" | "path" | null
	repairRequired: boolean
	compatible: boolean
	compatibility: "ok" | "too-old" | "too-new" | "blocked" | "unknown"
	message: string | null
}

// ============================================================
// Binary detection
// ============================================================

/** Run a command and return stdout, or null on failure. */
function execAsync(cmd: string, args: string[]): Promise<string | null> {
	return new Promise((resolve) => {
		execFile(cmd, args, { env: process.env, timeout: 5000 }, (err, stdout) => {
			if (err) {
				resolve(null)
				return
			}
			resolve(stdout.trim())
		})
	})
}

function toCheckSource(source: RuntimeSource): "bundled" | "user" | "path" {
	return source === "bundled" || source === "path" ? source : "user"
}

/** Try to find the opencode binary and get its version. */
async function detectOpenCode(): Promise<{
	version: string | null
	path: string | null
	source: "bundled" | "user" | "path" | null
}> {
	const runtime = resolveOpenCodeRuntime({
		isPackaged: app.isPackaged,
		resourcesPath: process.resourcesPath,
	})
	if (!runtime) return { version: null, path: null, source: null }

	const versionOutput = await execAsync(runtime.path, ["--version"])
	if (versionOutput) {
		const match = versionOutput.match(/v?(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)/)
		const version = match ? match[1] : versionOutput.trim()
		return { version, path: runtime.path, source: toCheckSource(runtime.source) }
	}

	return { version: null, path: runtime.path, source: toCheckSource(runtime.source) }
}

// ============================================================
// Public API
// ============================================================

/**
 * Check whether OpenCode is installed and compatible with this version of Palot.
 * Runs the binary to get its version, then compares against the compatibility range.
 */
export async function checkOpenCode(): Promise<OpenCodeCheckResult> {
	log.info("Checking OpenCode installation...")

	const { version, path: binaryPath, source } = await detectOpenCode()

	if (!version) {
		log.warn("OpenCode CLI not found")
		const repairRequired = app.isPackaged && process.platform === "win32" && process.arch === "x64"
		return {
			installed: false,
			version: null,
			path: binaryPath,
			source,
			repairRequired,
			compatible: false,
			compatibility: "unknown",
			message:
				repairRequired
					? "The included OpenCode runtime is missing or cannot run. Reinstall Palot to repair the installation."
					: "OpenCode CLI not found. Install it from https://opencode.ai",
		}
	}

	log.info("OpenCode found", { version, path: binaryPath })

	// Coerce loose version strings (e.g. "1.3" -> "1.3.0") into valid semver.
	// Non-semver versions (e.g. "local", "dev", "unknown") are assumed compatible --
	// these are typically local/dev builds where the user knows what they're doing.
	const parsed = valid(version) ?? coerce(version)?.version ?? null
	if (!parsed) {
		log.info("Non-semver version detected, assuming compatible", { version })
		return {
			installed: true,
			version,
			path: binaryPath,
			source,
			repairRequired: false,
			compatible: true,
			compatibility: "ok",
			message: null,
		}
	}

	// Check blocked versions
	for (const blocked of OPENCODE_COMPAT.blocked) {
		if (satisfies(parsed, blocked)) {
			return {
				installed: true,
				version,
				path: binaryPath,
				source,
				repairRequired: false,
				compatible: false,
				compatibility: "blocked",
				message: `OpenCode ${version} has known issues with this version of Palot. Please update.`,
			}
		}
	}

	// Check supported range -- hard block if below minimum
	if (!satisfies(parsed, OPENCODE_COMPAT.supported)) {
		return {
			installed: true,
			version,
			path: binaryPath,
			source,
			repairRequired: false,
			compatible: false,
			compatibility: "too-old",
			message: `OpenCode ${version} is too old. Palot requires ${OPENCODE_COMPAT.supported}.`,
		}
	}

	// Check tested range -- supported but newer than what we've tested against
	if (!satisfies(parsed, OPENCODE_COMPAT.tested)) {
		return {
			installed: true,
			version,
			path: binaryPath,
			source,
			repairRequired: false,
			compatible: true,
			compatibility: "too-new",
			message: `OpenCode ${version} is newer than tested. Palot is tested with ${OPENCODE_COMPAT.tested}. Some features may not work as expected.`,
		}
	}

	// Within the tested range -- fully compatible
	return {
		installed: true,
		version,
		path: binaryPath,
		source,
		repairRequired: false,
		compatible: true,
		compatibility: "ok",
		message: null,
	}
}
