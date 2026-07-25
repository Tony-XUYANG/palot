import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

const SEALOS_CLIENT_ID = "af993c98-d19d-4bdc-b338-79b80dc4f8bf"
export const SEALOS_REGIONS = [
	"https://gzg.sealos.run",
	"https://bja.sealos.run",
	"https://hzh.sealos.run",
	"https://usw-1.sealos.io",
] as const

interface PendingLogin {
	region: string
	deviceCode: string
	intervalSeconds: number
	expiresAt: number
}

const pendingLogins = new Map<string, PendingLogin>()

export type SealosCheckStatus = "ready" | "missing" | "warning"

export interface SealosPreflightCheck {
	id: "project" | "git" | "docker" | "sealos" | "auth" | "container"
	label: string
	status: SealosCheckStatus
	detail: string
}

export interface SealosPreflightResult {
	projectName: string
	framework: string | null
	port: number | null
	checks: SealosPreflightCheck[]
	ready: boolean
}

export interface SealosDeployResult {
	success: boolean
	status: number
	region: string
	response: unknown
	appUrl: string | null
	logPath: string
}

export interface SealosLoginStartResult {
	sessionId: string
	userCode: string
	verificationUrl: string
	expiresAt: number
}

export interface SealosLoginResult {
	authenticated: boolean
	region: string
	workspace: string | null
}

export interface SealosRuntimeResult {
	ok: boolean
	status: number | null
	url: string
	detail: string
}

async function exists(filePath: string): Promise<boolean> {
	try {
		await access(filePath)
		return true
	} catch {
		return false
	}
}

async function findCommand(commands: string[]): Promise<string | null> {
	for (const command of commands) {
		try {
			const locator = process.platform === "win32" ? "where.exe" : "which"
			const { stdout } = await execFileAsync(locator, [command], { windowsHide: true })
			const executable = stdout.trim().split(/\r?\n/)[0]
			if (executable) return executable
		} catch {
			// Try the next supported executable name.
		}
	}
	return null
}

function normalizeRegion(region: string): string {
	const normalized = new URL(region).origin
	if (!SEALOS_REGIONS.includes(normalized as (typeof SEALOS_REGIONS)[number])) {
		throw new Error("Unsupported Sealos region")
	}
	return normalized
}

async function fetchJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
	const response = await fetch(url, init)
	const text = await response.text()
	if (!response.ok) throw new Error(`Sealos request failed (${response.status}): ${text}`)
	return text ? (JSON.parse(text) as Record<string, unknown>) : {}
}

export async function startSealosLogin(region: string): Promise<SealosLoginStartResult> {
	const normalizedRegion = normalizeRegion(region)
	const payload = await fetchJson(`${normalizedRegion}/api/auth/oauth2/device`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: SEALOS_CLIENT_ID,
			grant_type: "urn:ietf:params:oauth:grant-type:device_code",
		}),
	})
	const deviceCode = String(payload.device_code ?? "")
	const userCode = String(payload.user_code ?? "")
	const verificationUrl = String(payload.verification_uri_complete ?? payload.verification_uri ?? "")
	const expiresIn = Number(payload.expires_in ?? 600)
	const intervalSeconds = Number(payload.interval ?? 5)
	if (!deviceCode || !userCode || !verificationUrl) throw new Error("Invalid Sealos login response")

	const sessionId = randomUUID()
	const expiresAt = Date.now() + Math.min(expiresIn, 600) * 1000
	pendingLogins.set(sessionId, {
		region: normalizedRegion,
		deviceCode,
		intervalSeconds,
		expiresAt,
	})
	return { sessionId, userCode, verificationUrl, expiresAt }
}

function readNestedString(value: unknown, pathParts: string[]): string | null {
	let current = value
	for (const part of pathParts) {
		if (!current || typeof current !== "object") return null
		current = (current as Record<string, unknown>)[part]
	}
	return typeof current === "string" ? current : null
}

export async function completeSealosLogin(sessionId: string): Promise<SealosLoginResult> {
	const login = pendingLogins.get(sessionId)
	if (!login) throw new Error("Login session expired. Start again.")
	let pollInterval = login.intervalSeconds * 1000
	try {
		while (Date.now() < login.expiresAt) {
			await new Promise((resolve) => setTimeout(resolve, pollInterval))
			const response = await fetch(`${login.region}/api/auth/oauth2/token`, {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					client_id: SEALOS_CLIENT_ID,
					grant_type: "urn:ietf:params:oauth:grant-type:device_code",
					device_code: login.deviceCode,
				}),
			})
			const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
			if (!response.ok) {
				if (body.error === "authorization_pending") continue
				if (body.error === "slow_down") {
					pollInterval += 5000
					continue
				}
				throw new Error(String(body.error ?? "Sealos authorization failed"))
			}
			const accessToken = String(body.access_token ?? "")
			if (!accessToken) throw new Error("Sealos token response is incomplete")
			const regionData = await fetchJson(`${login.region}/api/auth/regionToken`, {
				method: "POST",
				headers: { Authorization: accessToken, "Content-Type": "application/json" },
			})
			const regionalToken = readNestedString(regionData, ["data", "token"])
			const kubeconfig = readNestedString(regionData, ["data", "kubeconfig"])
			if (!regionalToken || !kubeconfig) throw new Error("Sealos workspace credentials are incomplete")

			let workspace: string | null = null
			try {
				const workspaceData = await fetchJson(`${login.region}/api/auth/namespace/list`, {
					headers: { Authorization: regionalToken },
				})
				const candidates = (workspaceData.data as { namespaces?: unknown[] } | undefined)?.namespaces
				const selected = candidates?.find(
					(item) => (item as { nstype?: string }).nstype === "private",
				) ?? candidates?.[0]
				workspace = selected ? String((selected as { id?: string }).id ?? "") || null : null
			} catch {
				// Workspace metadata is optional; the kubeconfig remains authoritative.
			}

			const sealosDirectory = path.join(os.homedir(), ".sealos")
			await mkdir(sealosDirectory, { recursive: true })
			await Promise.all([
				writeFile(path.join(sealosDirectory, "kubeconfig"), kubeconfig, { mode: 0o600 }),
				writeFile(
					path.join(sealosDirectory, "auth.json"),
					JSON.stringify(
						{
							region: login.region,
							access_token: accessToken,
							regional_token: regionalToken,
							authenticated_at: new Date().toISOString(),
							auth_method: "oauth2_device_grant",
							current_workspace: workspace ? { id: workspace } : undefined,
						},
						null,
						2,
					),
					{ mode: 0o600 },
				),
			])
			return { authenticated: true, region: login.region, workspace }
		}
		throw new Error("Sealos authorization timed out")
	} finally {
		pendingLogins.delete(sessionId)
	}
}

async function detectProject(directory: string): Promise<{
	framework: string | null
	port: number | null
	valid: boolean
}> {
	const packagePath = path.join(directory, "package.json")
	const [hasPackage, hasPyproject, hasRequirements] = await Promise.all([
		exists(packagePath),
		exists(path.join(directory, "pyproject.toml")),
		exists(path.join(directory, "requirements.txt")),
	])
	if (!hasPackage) {
		const valid = hasPyproject || hasRequirements
		return { framework: valid ? "Python" : null, port: valid ? 8000 : null, valid }
	}

	try {
		const pkg = JSON.parse(await readFile(packagePath, "utf8")) as {
			dependencies?: Record<string, string>
			devDependencies?: Record<string, string>
		}
		const dependencies = { ...pkg.dependencies, ...pkg.devDependencies }
		if (dependencies.next) return { framework: "Next.js", port: 3000, valid: true }
		if (dependencies.nuxt) return { framework: "Nuxt", port: 3000, valid: true }
		if (dependencies.vite) return { framework: "Vite", port: 4173, valid: true }
		if (dependencies.express) return { framework: "Express", port: 3000, valid: true }
		return { framework: "Node.js", port: 3000, valid: true }
	} catch {
		return { framework: null, port: null, valid: false }
	}
}

export async function runSealosPreflight(directory: string): Promise<SealosPreflightResult> {
	const resolved = path.resolve(directory)
	const [project, git, docker, sealos, hasDockerfile, hasCompose, hasTemplate] = await Promise.all([
		detectProject(resolved),
		findCommand(["git"]),
		findCommand(["docker"]),
		findCommand(["sealos-cli", "sealos"]),
		exists(path.join(resolved, "Dockerfile")),
		exists(path.join(resolved, "docker-compose.yml")),
		exists(path.join(resolved, ".sealos", "template", "index.yaml")),
	])

	const [hasKubeconfig, hasAuth] = await Promise.all([
		exists(path.join(os.homedir(), ".sealos", "kubeconfig")),
		exists(path.join(os.homedir(), ".sealos", "auth.json")),
	])
	const authenticated = hasKubeconfig && hasAuth

	const checks: SealosPreflightCheck[] = [
		{ id: "project", label: "Web project", status: project.valid ? "ready" : "missing", detail: project.valid ? `${project.framework} project detected` : "No supported web workload detected" },
		{ id: "git", label: "Git", status: git ? "ready" : "warning", detail: git ? "Available" : "Recommended for source versioning" },
		{ id: "docker", label: "Docker", status: docker ? "ready" : "warning", detail: docker ? "Available for image builds" : "Only required when the agent must build a new image" },
		{ id: "sealos", label: "Sealos CLI", status: sealos ? "ready" : "warning", detail: sealos ? "Available for advanced diagnostics" : "Optional; sign-in and deployment are built in" },
		{ id: "auth", label: "Sealos account", status: authenticated ? "ready" : "missing", detail: authenticated ? "Signed in" : "Sign in and select a workspace" },
		{ id: "container", label: "Sealos template", status: hasTemplate ? "ready" : "missing", detail: hasTemplate ? "Ready to submit through the Sealos Template API" : hasDockerfile || hasCompose ? "Container files found; ask the agent to generate .sealos/template/index.yaml" : "Ask the agent to create a Dockerfile and .sealos/template/index.yaml" },
	]

	return {
		projectName: path.basename(resolved),
		framework: project.framework,
		port: project.port,
		checks,
		ready: checks.every((check) => check.status !== "missing"),
	}
}

function findAppUrl(value: unknown, seen = new Set<unknown>()): string | null {
	if (typeof value === "string") {
		try {
			const url = new URL(value)
			return url.protocol === "https:" && !url.hostname.startsWith("template.") ? url.href : null
		} catch {
			return null
		}
	}
	if (!value || typeof value !== "object" || seen.has(value)) return null
	seen.add(value)
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		if (/^(app_?url|url|domain)$/i.test(key)) {
			const direct = findAppUrl(child, seen)
			if (direct) return direct
		}
	}
	for (const child of Object.values(value as Record<string, unknown>)) {
		const nested = findAppUrl(child, seen)
		if (nested) return nested
	}
	return null
}

async function postTemplate(
	deployUrl: string,
	kubeconfig: string,
	yaml: string,
	dryRun: boolean,
): Promise<{ status: number; payload: unknown }> {
	const response = await fetch(deployUrl, {
		method: "POST",
		headers: {
			Authorization: encodeURIComponent(kubeconfig),
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ yaml, args: {}, dryRun }),
	})
	const responseText = await response.text()
	let payload: unknown = responseText
	try {
		payload = responseText ? JSON.parse(responseText) : null
	} catch {
		// Preserve a non-JSON response for diagnostics.
	}
	if (!response.ok) throw new Error(`Sealos deployment failed (${response.status}): ${responseText}`)
	return { status: response.status, payload }
}

export async function deployToSealos(directory: string): Promise<SealosDeployResult> {
	const sealosDirectory = path.join(os.homedir(), ".sealos")
	const logDirectory = path.join(sealosDirectory, "logs")
	await mkdir(logDirectory, { recursive: true })
	const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-")
	const logPath = path.join(logDirectory, `deploy-${timestamp}.log`)
	await writeFile(logPath, `[${new Date().toISOString()}] Deploy started\n`, "utf8")
	const templatePath = path.join(path.resolve(directory), ".sealos", "template", "index.yaml")
	const [authText, kubeconfig, yaml] = await Promise.all([
		readFile(path.join(sealosDirectory, "auth.json"), "utf8"),
		readFile(path.join(sealosDirectory, "kubeconfig"), "utf8"),
		readFile(templatePath, "utf8"),
	])
	const auth = JSON.parse(authText) as { region?: string }
	if (!auth.region) throw new Error("Sealos authentication is missing a region")
	const regionUrl = new URL(normalizeRegion(auth.region))
	const deployUrl = `https://template.${regionUrl.host}/api/v2alpha/templates/raw`
	try {
		await appendFile(logPath, `[${new Date().toISOString()}] === Phase 5: Template dry-run ===\n`)
		await postTemplate(deployUrl, kubeconfig, yaml, true)
		await appendFile(logPath, `[${new Date().toISOString()}] Dry-run accepted\n`)
		await appendFile(logPath, `[${new Date().toISOString()}] === Phase 6: Deploy ===\n`)
		const result = await postTemplate(deployUrl, kubeconfig, yaml, false)
		const appUrl = findAppUrl(result.payload)
		await appendFile(
			logPath,
			`[${new Date().toISOString()}] Deployment accepted${appUrl ? `: ${appUrl}` : ""}\n`,
		)
		return {
			success: true,
			status: result.status,
			region: regionUrl.origin,
			response: result.payload,
			appUrl,
			logPath,
		}
	} catch (error) {
		await appendFile(
			logPath,
			`[${new Date().toISOString()}] ERROR: ${error instanceof Error ? error.message : String(error)}\n`,
		)
		throw error
	}
}

export async function verifySealosRuntime(url: string): Promise<SealosRuntimeResult> {
	const parsed = new URL(url)
	if (parsed.protocol !== "https:") throw new Error("Only HTTPS application URLs can be verified")
	try {
		const response = await fetch(parsed, {
			method: "GET",
			redirect: "follow",
			signal: AbortSignal.timeout(15_000),
		})
		const acceptable = response.status >= 200 && response.status < 500
		return {
			ok: acceptable,
			status: response.status,
			url: response.url || parsed.href,
			detail: acceptable ? "Public endpoint responded" : `Endpoint returned HTTP ${response.status}`,
		}
	} catch (error) {
		return {
			ok: false,
			status: null,
			url: parsed.href,
			detail: error instanceof Error ? error.message : "Runtime verification failed",
		}
	}
}
