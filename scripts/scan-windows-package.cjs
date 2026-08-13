/**
 * Scans an unpacked Windows package and its app.asar without printing matched secret values.
 */

const { readdirSync, readFileSync, statSync } = require("node:fs")
const path = require("node:path")
const { extractFile, listPackage } = require("@electron/asar")

const MAX_TEXT_FILE_BYTES = 32 * 1024 * 1024
const TEXT_EXTENSIONS = new Set([
	".cjs",
	".conf",
	".cts",
	".css",
	".html",
	".ini",
	".js",
	".json",
	".jsonc",
	".map",
	".md",
	".mdx",
	".mjs",
	".mts",
	".properties",
	".ps1",
	".sh",
	".svg",
	".toml",
	".ts",
	".tsx",
	".txt",
	".xml",
	".yaml",
	".yml",
])

const FORBIDDEN_PATHS = [
	{ label: "OpenCode credentials", pattern: /(?:^|\/)auth\.json$/i },
	{ label: "kubeconfig", pattern: /(?:^|\/)kubeconfig(?:\.[^/]*)?$/i },
	{ label: "Palot database", pattern: /(?:^|\/)palot\.db(?:-|$)/i },
	{ label: "environment file", pattern: /(?:^|\/)\.env(?:\.|$)/i },
	{ label: "agent smoke artifact", pattern: /(?:^|\/)(?:\.local\/)?agent-smoke(?:\/|$)/i },
	{ label: "acceptance artifact", pattern: /(?:^|\/)windows-acceptance(?:\/|$)/i },
	{
		label: "local Sealos state",
		pattern: /(?:^|\/)\.sealos\/(?:analysis|state|template-match)\.json$/i,
	},
]

const SECRET_PATTERNS = [
	{
		label: "OpenAI API key",
		pattern: /\b(?:sk-(?:proj|svcacct)-[A-Za-z0-9_-]{24,}|sk-[A-Za-z0-9]{40,})\b/,
		scanDependencies: true,
	},
	{
		label: "GitHub token",
		pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
		scanDependencies: true,
	},
	{
		label: "OAuth callback code",
		pattern: /\bac_[A-Za-z0-9._-]{24,}\b/,
		scanDependencies: true,
	},
	{
		label: "bearer credential",
		pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}={0,2}\b/i,
		scanDependencies: true,
	},
	{
		label: "private key",
		pattern:
			/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----\s+[A-Za-z0-9+/=\r\n]{100,}\s+-----END (?:[A-Z ]+ )?PRIVATE KEY-----/,
	},
	{
		label: "JWT",
		pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
	},
	{
		label: "credential-bearing database URL",
		pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s/:]+:[^\s/@]+@/i,
	},
	{
		label: "embedded kubeconfig credential",
		pattern: /\b(?:client-key-data|token):\s*[A-Za-z0-9+/=_-]{24,}/i,
	},
]

function normalizeEntryPath(file) {
	return file.replaceAll("\\", "/").replace(/^\/+/, "")
}

function parseArguments(args) {
	if (args.length !== 2 || args[0] !== "--root" || !args[1]) {
		throw new Error("Usage: node scripts/scan-windows-package.cjs --root <win-unpacked>")
	}
	return { root: path.resolve(args[1]) }
}

function isTextFile(file, size) {
	return size <= MAX_TEXT_FILE_BYTES && TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())
}

function findPathFinding(file) {
	const normalized = normalizeEntryPath(file)
	return FORBIDDEN_PATHS.find(({ pattern }) => pattern.test(normalized))?.label
}

function scanText(content, file, findings, dependenciesOnly = false) {
	for (const { label, pattern, scanDependencies } of SECRET_PATTERNS) {
		if (dependenciesOnly && !scanDependencies) continue
		if (pattern.test(content)) findings.push({ label, file })
	}
}

function walkFiles(root) {
	const files = []
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const fullPath = path.join(root, entry.name)
		if (entry.isDirectory()) files.push(...walkFiles(fullPath))
		else if (entry.isFile()) files.push(fullPath)
	}
	return files
}

function scanAsar(archivePath, findings) {
	const entries = listPackage(archivePath, { isPack: false }).map((archiveEntry) => ({
		archiveEntry: archiveEntry.replace(/^[/\\]+/, ""),
		entry: normalizeEntryPath(archiveEntry),
	}))
	const directories = new Set()
	for (const { entry } of entries) {
		let parent = path.posix.dirname(entry)
		while (parent !== ".") {
			directories.add(parent)
			parent = path.posix.dirname(parent)
		}
	}
	for (const { archiveEntry, entry } of entries) {
		const pathFinding = findPathFinding(entry)
		if (pathFinding) findings.push({ label: pathFinding, file: `app.asar/${entry}` })
		if (directories.has(entry)) continue
		try {
			const entryBuffer = extractFile(archivePath, archiveEntry)
			if (isTextFile(entry, entryBuffer.length)) {
				scanText(
					entryBuffer.toString("utf8"),
					`app.asar/${entry}`,
					findings,
					entry.toLowerCase().startsWith("node_modules/"),
				)
			}
		} catch (error) {
			if (pathFinding) continue
			throw new Error(`Unable to inspect app.asar/${entry}: ${error.message}`)
		}
	}
}

function scanWindowsPackage(root) {
	const resolvedRoot = path.resolve(root)
	if (!statSync(resolvedRoot).isDirectory())
		throw new Error(`Package root is not a directory: ${resolvedRoot}`)
	for (const required of [
		"Palot.exe",
		"resources/app.asar",
		"resources/runtime/runtime-manifest.json",
	]) {
		const requiredPath = path.join(resolvedRoot, ...required.split("/"))
		try {
			if (!statSync(requiredPath).isFile()) throw new Error("not a file")
		} catch {
			throw new Error(`Required packaged file is missing: ${required}`)
		}
	}
	const findings = []
	for (const file of walkFiles(resolvedRoot)) {
		const relative = normalizeEntryPath(path.relative(resolvedRoot, file))
		const pathFinding = findPathFinding(relative)
		if (pathFinding) findings.push({ label: pathFinding, file: relative })
		if (relative.toLowerCase() === "resources/app.asar") {
			scanAsar(file, findings)
			continue
		}
		const size = statSync(file).size
		if (isTextFile(relative, size)) {
			scanText(
				readFileSync(file, "utf8"),
				relative,
				findings,
				relative.toLowerCase().includes("node_modules/"),
			)
		}
	}
	return findings
}

function main() {
	const { root } = parseArguments(process.argv.slice(2))
	const findings = scanWindowsPackage(root)
	if (findings.length > 0) {
		for (const finding of findings) console.error(`BLOCKED: ${finding.label} in ${finding.file}`)
		throw new Error(`Windows package sensitive-information scan found ${findings.length} issue(s)`)
	}
	console.log("Windows package sensitive-information scan passed.")
}

if (require.main === module) {
	try {
		main()
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error))
		process.exitCode = 1
	}
}

module.exports = { parseArguments, scanWindowsPackage }
