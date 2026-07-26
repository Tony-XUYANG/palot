/**
 * Resolves external runtimes without modifying PATH.
 *
 * Windows production builds require the bundled runtime. Development and
 * non-Windows builds retain user-install and system PATH fallbacks.
 */

import { statSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

export const OPENCODE_RUNTIME_VERSION = "1.18.5"
export const MINGIT_RUNTIME_VERSION = "2.55.0.3"
export const GITHUB_CLI_RUNTIME_VERSION = "2.96.0"
export const KUBECTL_RUNTIME_VERSION = "1.36.1"

export type RuntimeKind = "opencode" | "git" | "github" | "kubectl"
export type RuntimeSource = "override" | "bundled" | "user" | "path"

export interface ResolvedRuntime {
	kind: RuntimeKind
	path: string
	source: RuntimeSource
}

export interface RuntimeResolverOptions {
	isPackaged: boolean
	resourcesPath?: string
	platform?: NodeJS.Platform
	arch?: string
	homeDirectory?: string
	environment?: NodeJS.ProcessEnv
	fileExists?: (candidate: string) => boolean
}

function isFile(candidate: string): boolean {
	try {
		return statSync(candidate).isFile()
	} catch {
		return false
	}
}

function getPlatformPath(platform: NodeJS.Platform): typeof path.win32 {
	return platform === "win32" ? path.win32 : path.posix
}

function getBundledCandidate(kind: RuntimeKind, options: RuntimeResolverOptions): string | null {
	const platform = options.platform ?? process.platform
	const arch = options.arch ?? process.arch
	if (!options.isPackaged || platform !== "win32" || arch !== "x64" || !options.resourcesPath) {
		return null
	}

	const pathApi = getPlatformPath(platform)
	if (kind === "opencode") {
		return pathApi.join(options.resourcesPath, "runtime", "opencode", "opencode.exe")
	}
	if (kind === "github") {
		return pathApi.join(options.resourcesPath, "runtime", "github", "bin", "gh.exe")
	}
	if (kind === "kubectl") {
		return pathApi.join(options.resourcesPath, "runtime", "kubectl", "kubectl.exe")
	}
	return pathApi.join(options.resourcesPath, "runtime", "mingit", "cmd", "git.exe")
}

function getUserCandidates(kind: RuntimeKind, options: RuntimeResolverOptions): string[] {
	const platform = options.platform ?? process.platform
	const pathApi = getPlatformPath(platform)
	const home = options.homeDirectory ?? homedir()
	const environment = options.environment ?? process.env

	if (kind === "opencode") {
		return [
			pathApi.join(home, ".opencode", "bin", platform === "win32" ? "opencode.exe" : "opencode"),
		]
	}
	if (kind === "github") {
		const candidates: string[] = []
		if (platform === "win32" && environment.ProgramFiles) {
			candidates.push(pathApi.join(environment.ProgramFiles, "GitHub CLI", "gh.exe"))
		}
		return candidates
	}
	if (kind === "kubectl") {
		const candidates: string[] = []
		if (platform === "win32" && environment.LOCALAPPDATA) {
			candidates.push(
				pathApi.join(
					environment.LOCALAPPDATA,
					"Programs",
					"Docker",
					"Docker",
					"resources",
					"bin",
					"kubectl.exe",
				),
			)
		}
		return candidates
	}

	const candidates = [
		pathApi.join(
			home,
			".local",
			"share",
			"palot",
			"tools",
			`mingit-${MINGIT_RUNTIME_VERSION}`,
			"cmd",
			"git.exe",
		),
	]
	if (platform === "win32" && environment.LOCALAPPDATA) {
		candidates.push(pathApi.join(environment.LOCALAPPDATA, "Programs", "Git", "cmd", "git.exe"))
	}
	return candidates
}

function getPathCandidates(kind: RuntimeKind, options: RuntimeResolverOptions): string[] {
	const platform = options.platform ?? process.platform
	const pathApi = getPlatformPath(platform)
	const environment = options.environment ?? process.env
	const pathValue = environment.PATH ?? environment.Path ?? ""
	const filenames =
		platform === "win32"
			? kind === "opencode"
				? ["opencode.exe", "opencode.cmd", "opencode"]
				: kind === "github"
					? ["gh.exe", "gh.cmd", "gh"]
					: kind === "kubectl"
						? ["kubectl.exe", "kubectl.cmd", "kubectl"]
						: ["git.exe", "git.cmd", "git"]
			: [
					kind === "opencode"
						? "opencode"
						: kind === "github"
							? "gh"
							: kind === "kubectl"
								? "kubectl"
								: "git",
				]

	const candidates: string[] = []
	for (const directory of pathValue.split(platform === "win32" ? ";" : ":")) {
		const trimmed = directory.trim().replace(/^"|"$/g, "")
		if (!trimmed) continue
		for (const filename of filenames) {
			candidates.push(pathApi.resolve(trimmed, filename))
		}
	}
	return candidates
}

function resolveRuntime(
	kind: RuntimeKind,
	overrideName:
		| "PALOT_TEST_OPENCODE_PATH"
		| "PALOT_TEST_GIT_PATH"
		| "PALOT_TEST_GH_PATH"
		| "PALOT_TEST_KUBECTL_PATH",
	options: RuntimeResolverOptions,
): ResolvedRuntime | null {
	const platform = options.platform ?? process.platform
	const pathApi = getPlatformPath(platform)
	const environment = options.environment ?? process.env
	const fileExists = options.fileExists ?? isFile
	const override = environment[overrideName]
	if (override) {
		if (!pathApi.isAbsolute(override)) {
			throw new Error(`${overrideName} must be an absolute path`)
		}
		if (!fileExists(override)) {
			throw new Error(`${overrideName} does not point to a file: ${override}`)
		}
		return { kind, path: pathApi.normalize(override), source: "override" }
	}

	const bundled = getBundledCandidate(kind, options)
	if (bundled && fileExists(bundled)) {
		return { kind, path: bundled, source: "bundled" }
	}

	// A packaged Windows x64 app must never silently substitute a different
	// runtime for missing installer content.
	if (bundled) return null

	for (const candidate of getUserCandidates(kind, options)) {
		if (fileExists(candidate)) return { kind, path: candidate, source: "user" }
	}
	for (const candidate of getPathCandidates(kind, options)) {
		if (fileExists(candidate)) return { kind, path: candidate, source: "path" }
	}
	return null
}

export function resolveOpenCodeRuntime(options: RuntimeResolverOptions): ResolvedRuntime | null {
	return resolveRuntime("opencode", "PALOT_TEST_OPENCODE_PATH", options)
}

export function resolveGitRuntime(options: RuntimeResolverOptions): ResolvedRuntime | null {
	return resolveRuntime("git", "PALOT_TEST_GIT_PATH", options)
}

export function resolveGitHubRuntime(options: RuntimeResolverOptions): ResolvedRuntime | null {
	return resolveRuntime("github", "PALOT_TEST_GH_PATH", options)
}

export function resolveKubectlRuntime(options: RuntimeResolverOptions): ResolvedRuntime | null {
	return resolveRuntime("kubectl", "PALOT_TEST_KUBECTL_PATH", options)
}
