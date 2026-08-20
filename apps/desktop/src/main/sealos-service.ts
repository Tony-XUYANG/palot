import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	access,
	appendFile,
	mkdir,
	readFile,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { parseAllDocuments } from "yaml";
import { resolveKubectlRuntime } from "./runtime-resolver";

const execFileAsync = promisify(execFile);

const SEALOS_CLIENT_ID = "af993c98-d19d-4bdc-b338-79b80dc4f8bf";
const DIRECT_SEALOS_DOMAINS = ["sealos.run", "sealos.io", "sealoshzh.site"];
export const SEALOS_REGIONS = [
	"https://gzg.sealos.run",
	"https://bja.sealos.run",
	"https://hzh.sealos.run",
	"https://usw-1.sealos.io",
] as const;

interface PendingLogin {
	region: string;
	deviceCode: string;
	intervalSeconds: number;
	expiresAt: number;
}

const pendingLogins = new Map<string, PendingLogin>();

export type SealosCheckStatus = "ready" | "missing" | "warning";

export interface SealosPreflightCheck {
	id: "project" | "git" | "docker" | "sealos" | "auth" | "container";
	label: string;
	status: SealosCheckStatus;
	detail: string;
}

export interface SealosPreflightResult {
	projectName: string;
	framework: string | null;
	port: number | null;
	region: string | null;
	workspace: string | null;
	checks: SealosPreflightCheck[];
	ready: boolean;
}

export interface SealosDeployResult {
	success: boolean;
	status: number;
	region: string;
	response: unknown;
	appUrl: string | null;
	instanceName: string | null;
	logPath: string;
}

export interface SealosWorkspace {
	uid: string;
	id: string;
	teamName: string;
	current: boolean;
}

export interface SealosTemplateInput {
	name: string;
	description: string;
	required: boolean;
	defaultValue: string | null;
	sensitive: boolean;
}

export interface SealosLoginStartResult {
	sessionId: string;
	userCode: string;
	verificationUrl: string;
	expiresAt: number;
}

export interface SealosLoginResult {
	authenticated: boolean;
	region: string;
	workspace: string | null;
}

export interface SealosRuntimeResult {
	ok: boolean;
	status: number | null;
	url: string;
	detail: string;
	checks: {
		id:
			| "deployment"
			| "endpoints"
			| "ingress"
			| "launchpad"
			| "root"
			| "health"
			| "missing-path"
			| "failure-text"
			| "logs"
			| "stability";
		ok: boolean;
		detail: string;
	}[];
}

export interface SealosClusterSnapshot {
	deploymentReady: boolean;
	podsReady: boolean;
	endpointsReady: boolean;
	ingressReady: boolean;
	podUids: string[];
	restarts: Record<string, number>;
	severeLogCount: number;
}

export interface SealosDeploymentState {
	version: "1.0";
	last_deploy: {
		app_name: string;
		namespace: string;
		region: string;
		image: string;
		repo_name: string;
		url: string | null;
		deployed_at: string;
		last_updated_at: string;
	};
	history: {
		at: string;
		action: "deploy" | "set-image";
		status: "success" | "failed";
		method: "template-api" | "kubectl-set-image";
		image: string;
		previous_image?: string;
		note?: string;
	}[];
}

export interface SealosUpdateResult {
	success: boolean;
	appName: string;
	image: string;
	previousImage: string;
	url: string | null;
}

interface StoredSealosAuth {
	region?: string;
	access_token?: string;
	regional_token?: string;
	current_workspace?: { uid?: string; id?: string; teamName?: string };
}

async function exists(filePath: string): Promise<boolean> {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function findCommand(commands: string[]): Promise<string | null> {
	for (const command of commands) {
		try {
			const locator = process.platform === "win32" ? "where.exe" : "which";
			const { stdout } = await execFileAsync(locator, [command], {
				windowsHide: true,
			});
			const executable = stdout.trim().split(/\r?\n/)[0];
			if (executable) return executable;
		} catch {
			// Try the next supported executable name.
		}
	}
	return null;
}

function normalizeRegion(region: string): string {
	const normalized = new URL(region).origin;
	if (!SEALOS_REGIONS.includes(normalized as (typeof SEALOS_REGIONS)[number])) {
		throw new Error("Unsupported Sealos region");
	}
	return normalized;
}

export function isDirectSealosHost(hostname: string): boolean {
	const normalized = hostname.toLowerCase().replace(/\.$/, "");
	return DIRECT_SEALOS_DOMAINS.some(
		(domain) => normalized === domain || normalized.endsWith(`.${domain}`),
	);
}

export function createSealosLaunchpadUrl(region: string, appName: string): URL {
	const regionUrl = new URL(normalizeRegion(region));
	const endpoint = new URL(
		`https://applaunchpad.${regionUrl.host}/api/getAppByAppName`,
	);
	endpoint.searchParams.set("appName", appName);
	return endpoint;
}

async function palotFetch(
	input: string | URL,
	init?: RequestInit,
): Promise<Response> {
	const url = new URL(input.toString());
	if (isDirectSealosHost(url.hostname)) {
		const { default: nodeFetch } = await import("node-fetch");
		return nodeFetch(
			url,
			init as import("node-fetch").RequestInit,
		) as unknown as Response;
	}
	if (process.versions.electron) {
		const { net } = await import("electron");
		return net.fetch(url.toString(), init);
	}
	return globalThis.fetch(url, init);
}

async function fetchJson(
	url: string,
	init?: RequestInit,
): Promise<Record<string, unknown>> {
	const response = await palotFetch(url, init);
	const text = await response.text();
	if (!response.ok)
		throw new Error(`Sealos request failed (${response.status}): ${text}`);
	return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

async function readStoredAuth(): Promise<StoredSealosAuth> {
	const authPath = path.join(os.homedir(), ".sealos", "auth.json");
	return JSON.parse(await readFile(authPath, "utf8")) as StoredSealosAuth;
}

function getNamespaces(
	payload: Record<string, unknown>,
): Record<string, unknown>[] {
	const data = payload.data;
	const namespaces =
		data && typeof data === "object" && "namespaces" in data
			? (data as { namespaces?: unknown }).namespaces
			: data;
	return Array.isArray(namespaces)
		? namespaces.filter((item): item is Record<string, unknown> =>
				Boolean(item && typeof item === "object"),
			)
		: [];
}

export async function listSealosWorkspaces(): Promise<SealosWorkspace[]> {
	const auth = await readStoredAuth();
	if (!auth.region || !auth.regional_token) return [];
	const payload = await fetchJson(
		`${normalizeRegion(auth.region)}/api/auth/namespace/list`,
		{
			headers: { Authorization: auth.regional_token },
		},
	);
	return getNamespaces(payload).map((item) => ({
		uid: String(item.uid ?? ""),
		id: String(item.id ?? ""),
		teamName: String(item.teamName ?? item.id ?? "Workspace"),
		current: String(item.id ?? "") === auth.current_workspace?.id,
	}));
}

export async function switchSealosWorkspace(
	workspaceId: string,
): Promise<SealosWorkspace> {
	const auth = await readStoredAuth();
	if (!auth.region || !auth.regional_token)
		throw new Error("Sign in to Sealos first");
	const workspaces = await listSealosWorkspaces();
	const workspace = workspaces.find(
		(candidate) => candidate.id === workspaceId,
	);
	if (!workspace) throw new Error("Sealos workspace was not found");
	const region = normalizeRegion(auth.region);
	const switched = await fetchJson(`${region}/api/auth/namespace/switch`, {
		method: "POST",
		headers: {
			Authorization: auth.regional_token,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ ns_uid: workspace.uid }),
	});
	const regionalToken = readNestedString(switched, ["data", "token"]);
	if (!regionalToken)
		throw new Error("Sealos workspace switch did not return a regional token");
	const kubeconfigPayload = await fetchJson(
		`${region}/api/auth/getKubeconfig`,
		{
			headers: { Authorization: regionalToken },
		},
	);
	const kubeconfig = readNestedString(kubeconfigPayload, [
		"data",
		"kubeconfig",
	]);
	if (!kubeconfig)
		throw new Error("Sealos workspace did not return a kubeconfig");
	const sealosDirectory = path.join(os.homedir(), ".sealos");
	auth.regional_token = regionalToken;
	auth.current_workspace = {
		uid: workspace.uid,
		id: workspace.id,
		teamName: workspace.teamName,
	};
	await Promise.all([
		writeFile(
			path.join(sealosDirectory, "auth.json"),
			JSON.stringify(auth, null, 2),
			{
				mode: 0o600,
			},
		),
		writeFile(path.join(sealosDirectory, "kubeconfig"), kubeconfig, {
			mode: 0o600,
		}),
	]);
	return { ...workspace, current: true };
}

export async function startSealosLogin(
	region: string,
): Promise<SealosLoginStartResult> {
	const normalizedRegion = normalizeRegion(region);
	const payload = await fetchJson(
		`${normalizedRegion}/api/auth/oauth2/device`,
		{
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: SEALOS_CLIENT_ID,
				grant_type: "urn:ietf:params:oauth:grant-type:device_code",
			}),
		},
	);
	const deviceCode = String(payload.device_code ?? "");
	const userCode = String(payload.user_code ?? "");
	const verificationUrl = String(
		payload.verification_uri_complete ?? payload.verification_uri ?? "",
	);
	const expiresIn = Number(payload.expires_in ?? 600);
	const intervalSeconds = Number(payload.interval ?? 5);
	if (!deviceCode || !userCode || !verificationUrl)
		throw new Error("Invalid Sealos login response");

	const sessionId = randomUUID();
	const expiresAt = Date.now() + Math.min(expiresIn, 600) * 1000;
	pendingLogins.set(sessionId, {
		region: normalizedRegion,
		deviceCode,
		intervalSeconds,
		expiresAt,
	});
	return { sessionId, userCode, verificationUrl, expiresAt };
}

function readNestedString(value: unknown, pathParts: string[]): string | null {
	let current = value;
	for (const part of pathParts) {
		if (!current || typeof current !== "object") return null;
		current = (current as Record<string, unknown>)[part];
	}
	return typeof current === "string" ? current : null;
}

export async function completeSealosLogin(
	sessionId: string,
): Promise<SealosLoginResult> {
	const login = pendingLogins.get(sessionId);
	if (!login) throw new Error("Login session expired. Start again.");
	let pollInterval = login.intervalSeconds * 1000;
	try {
		while (Date.now() < login.expiresAt) {
			await new Promise((resolve) => setTimeout(resolve, pollInterval));
			const response = await palotFetch(
				`${login.region}/api/auth/oauth2/token`,
				{
					method: "POST",
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
					body: new URLSearchParams({
						client_id: SEALOS_CLIENT_ID,
						grant_type: "urn:ietf:params:oauth:grant-type:device_code",
						device_code: login.deviceCode,
					}),
				},
			);
			const body = (await response.json().catch(() => ({}))) as Record<
				string,
				unknown
			>;
			if (!response.ok) {
				if (body.error === "authorization_pending") continue;
				if (body.error === "slow_down") {
					pollInterval += 5000;
					continue;
				}
				throw new Error(String(body.error ?? "Sealos authorization failed"));
			}
			const accessToken = String(body.access_token ?? "");
			if (!accessToken) throw new Error("Sealos token response is incomplete");
			const regionData = await fetchJson(
				`${login.region}/api/auth/regionToken`,
				{
					method: "POST",
					headers: {
						Authorization: accessToken,
						"Content-Type": "application/json",
					},
				},
			);
			const regionalToken = readNestedString(regionData, ["data", "token"]);
			const kubeconfig = readNestedString(regionData, ["data", "kubeconfig"]);
			if (!regionalToken || !kubeconfig)
				throw new Error("Sealos workspace credentials are incomplete");

			let workspace: string | null = null;
			try {
				const workspaceData = await fetchJson(
					`${login.region}/api/auth/namespace/list`,
					{
						headers: { Authorization: regionalToken },
					},
				);
				const candidates = (
					workspaceData.data as { namespaces?: unknown[] } | undefined
				)?.namespaces;
				const selected =
					candidates?.find(
						(item) => (item as { nstype?: string }).nstype === "private",
					) ?? candidates?.[0];
				workspace = selected
					? String((selected as { id?: string }).id ?? "") || null
					: null;
			} catch {
				// Workspace metadata is optional; the kubeconfig remains authoritative.
			}

			const sealosDirectory = path.join(os.homedir(), ".sealos");
			await mkdir(sealosDirectory, { recursive: true });
			await Promise.all([
				writeFile(path.join(sealosDirectory, "kubeconfig"), kubeconfig, {
					mode: 0o600,
				}),
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
			]);
			return { authenticated: true, region: login.region, workspace };
		}
		throw new Error("Sealos authorization timed out");
	} finally {
		pendingLogins.delete(sessionId);
	}
}

async function detectProject(directory: string): Promise<{
	framework: string | null;
	port: number | null;
	valid: boolean;
}> {
	const packagePath = path.join(directory, "package.json");
	const [hasPackage, hasPyproject, hasRequirements] = await Promise.all([
		exists(packagePath),
		exists(path.join(directory, "pyproject.toml")),
		exists(path.join(directory, "requirements.txt")),
	]);
	if (!hasPackage) {
		const valid = hasPyproject || hasRequirements;
		return {
			framework: valid ? "Python" : null,
			port: valid ? 8000 : null,
			valid,
		};
	}

	try {
		const pkg = JSON.parse(await readFile(packagePath, "utf8")) as {
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};
		const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
		if (dependencies.next)
			return { framework: "Next.js", port: 3000, valid: true };
		if (dependencies.nuxt)
			return { framework: "Nuxt", port: 3000, valid: true };
		if (dependencies.vite)
			return { framework: "Vite", port: 4173, valid: true };
		if (dependencies.express)
			return { framework: "Express", port: 3000, valid: true };
		return { framework: "Node.js", port: 3000, valid: true };
	} catch {
		return { framework: null, port: null, valid: false };
	}
}

export async function runSealosPreflight(
	directory: string,
): Promise<SealosPreflightResult> {
	const resolved = path.resolve(directory);
	const [project, git, docker, sealos, hasDockerfile, hasCompose, hasTemplate] =
		await Promise.all([
			detectProject(resolved),
			findCommand(["git"]),
			findCommand(["docker"]),
			findCommand(["sealos-cli", "sealos"]),
			exists(path.join(resolved, "Dockerfile")),
			exists(path.join(resolved, "docker-compose.yml")),
			exists(path.join(resolved, ".sealos", "template", "index.yaml")),
		]);

	const [hasKubeconfig, hasAuth] = await Promise.all([
		exists(path.join(os.homedir(), ".sealos", "kubeconfig")),
		exists(path.join(os.homedir(), ".sealos", "auth.json")),
	]);
	const authenticated = hasKubeconfig && hasAuth;
	let auth: StoredSealosAuth = {};
	if (authenticated) {
		try {
			auth = await readStoredAuth();
		} catch {
			// The auth check below remains the user-facing source of truth.
		}
	}

	const checks: SealosPreflightCheck[] = [
		{
			id: "project",
			label: "Web project",
			status: project.valid ? "ready" : "missing",
			detail: project.valid
				? `${project.framework} project detected`
				: "No supported web workload detected",
		},
		{
			id: "git",
			label: "Git",
			status: git ? "ready" : "warning",
			detail: git ? "Available" : "Recommended for source versioning",
		},
		{
			id: "docker",
			label: "Docker",
			status: docker ? "ready" : "warning",
			detail: docker
				? "Available for image builds"
				: "Only required when the agent must build a new image",
		},
		{
			id: "sealos",
			label: "Sealos CLI",
			status: sealos ? "ready" : "warning",
			detail: sealos
				? "Available for advanced diagnostics"
				: "Optional; sign-in and deployment are built in",
		},
		{
			id: "auth",
			label: "Sealos account",
			status: authenticated ? "ready" : "missing",
			detail: authenticated ? "Signed in" : "Sign in and select a workspace",
		},
		{
			id: "container",
			label: "Sealos template",
			status: hasTemplate ? "ready" : "missing",
			detail: hasTemplate
				? "Ready to submit through the Sealos Template API"
				: hasDockerfile || hasCompose
					? "Container files found; ask the agent to generate .sealos/template/index.yaml"
					: "Ask the agent to create a Dockerfile and .sealos/template/index.yaml",
		},
	];

	return {
		projectName: path.basename(resolved),
		framework: project.framework,
		port: project.port,
		region: auth.region ?? null,
		workspace: auth.current_workspace?.id ?? null,
		checks,
		ready: checks.every((check) => check.status !== "missing"),
	};
}

function isSensitiveInput(name: string): boolean {
	return /(?:key|token|secret|password|credential)/i.test(name);
}

export async function readSealosTemplateInputs(
	directory: string,
): Promise<SealosTemplateInput[]> {
	const templatePath = path.join(
		path.resolve(directory),
		".sealos",
		"template",
		"index.yaml",
	);
	const documents = parseAllDocuments(await readFile(templatePath, "utf8"));
	for (const document of documents) {
		const value = document.toJS() as {
			kind?: string;
			spec?: { inputs?: Record<string, unknown> };
		} | null;
		if (value?.kind !== "Template" || !value.spec?.inputs) continue;
		return Object.entries(value.spec.inputs).map(([name, raw]) => {
			const input =
				raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
			return {
				name,
				description: String(input.description ?? name),
				required: input.required === true,
				defaultValue:
					input.default === undefined ? null : String(input.default),
				sensitive: isSensitiveInput(name),
			};
		});
	}
	return [];
}

export async function updateSealosTemplateImage(
	directory: string,
	image: string,
): Promise<void> {
	if (!/^ghcr\.io\/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$/.test(image)) {
		throw new Error("The remote build did not return an immutable GHCR image");
	}
	const templatePath = path.join(
		path.resolve(directory),
		".sealos",
		"template",
		"index.yaml",
	);
	const documents = parseAllDocuments(await readFile(templatePath, "utf8"));
	let updated = false;
	for (const document of documents) {
		const value = document.toJS() as {
			kind?: string;
			spec?: { template?: { spec?: { containers?: { image?: string }[] } } };
		} | null;
		if (value?.kind !== "Deployment") continue;
		const containers = value.spec?.template?.spec?.containers;
		if (!containers?.[0]) continue;
		document.setIn(
			["spec", "template", "spec", "containers", 0, "image"],
			image,
		);
		updated = true;
		break;
	}
	if (!updated)
		throw new Error(
			"The Sealos template does not contain an application Deployment",
		);
	await writeFile(
		templatePath,
		documents
			.filter((document) => document.toJS() !== null)
			.map((document) => document.toString())
			.join(""),
		"utf8",
	);
}

function getTemplateImage(yaml: string): string | null {
	const documents = parseAllDocuments(yaml);
	for (const document of documents) {
		const value = document.toJS() as {
			kind?: string;
			spec?: { template?: { spec?: { containers?: { image?: string }[] } } };
		} | null;
		if (value?.kind !== "Deployment") continue;
		const image = value.spec?.template?.spec?.containers?.[0]?.image;
		if (image) return image;
	}
	return null;
}

function getStatePath(directory: string): string {
	return path.join(path.resolve(directory), ".sealos", "state.json");
}

export async function readSealosDeploymentState(
	directory: string,
): Promise<SealosDeploymentState | null> {
	try {
		return JSON.parse(
			await readFile(getStatePath(directory), "utf8"),
		) as SealosDeploymentState;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

async function writeSealosDeploymentState(
	directory: string,
	state: SealosDeploymentState,
): Promise<void> {
	const statePath = getStatePath(directory);
	await mkdir(path.dirname(statePath), { recursive: true });
	await writeFile(statePath, JSON.stringify(state, null, 2), "utf8");
}

function getKubectlPath(): string {
	const electronProcess = process as NodeJS.Process & {
		defaultApp?: boolean;
		resourcesPath?: string;
	};
	const runtime = resolveKubectlRuntime({
		isPackaged: Boolean(
			electronProcess.resourcesPath && !electronProcess.defaultApp,
		),
		resourcesPath: electronProcess.resourcesPath,
	});
	if (!runtime)
		throw new Error(
			"kubectl is unavailable. Reinstall Palot to repair the runtime.",
		);
	return runtime.path;
}

async function kubectl(args: string[]): Promise<string> {
	const kubeconfig = path.join(os.homedir(), ".sealos", "kubeconfig");
	let lastError: unknown;
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			const { stdout } = await execFileAsync(
				getKubectlPath(),
				["--kubeconfig", kubeconfig, "--insecure-skip-tls-verify", ...args],
				{ encoding: "utf8", maxBuffer: 10 * 1024 * 1024, windowsHide: true },
			);
			return stdout.trim();
		} catch (error) {
			lastError = error;
			if (!isTransientKubectlError(error) || attempt === 2) throw error;
			await new Promise((resolve) =>
				setTimeout(resolve, 1_500 * (attempt + 1)),
			);
		}
	}
	throw lastError;
}

export function isTransientKubectlError(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const candidate = error as { message?: unknown; stderr?: unknown };
	const detail = `${String(candidate.message ?? "")}\n${String(candidate.stderr ?? "")}`;
	return /TLS handshake timeout|i\/o timeout|connection reset by peer|unexpected EOF|temporarily unavailable|dial tcp.+timeout|net\/http: request canceled/i.test(
		detail,
	);
}

export function isTransientFetchError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	return /fetch failed|network|timeout|timed out|socket|ECONNRESET|ETIMEDOUT|ERR_(?:CONNECTION|NETWORK|TIMED_OUT|PROXY|INTERNET)/i.test(
		`${error.name}: ${error.message}`,
	);
}

async function fetchWithRetry(
	request: () => Promise<Response>,
): Promise<Response> {
	let lastError: unknown;
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			return await request();
		} catch (error) {
			lastError = error;
			if (!isTransientFetchError(error) || attempt === 2) throw error;
			await new Promise((resolve) =>
				setTimeout(resolve, 1_500 * (attempt + 1)),
			);
		}
	}
	throw lastError;
}

interface KubernetesMetadata {
	name?: string;
	uid?: string;
	labels?: Record<string, string>;
}

interface KubernetesDeployment {
	metadata?: KubernetesMetadata & { generation?: number };
	spec?: {
		replicas?: number;
		selector?: { matchLabels?: Record<string, string> };
	};
	status?: {
		availableReplicas?: number;
		observedGeneration?: number;
		updatedReplicas?: number;
	};
}

interface KubernetesPod {
	metadata?: KubernetesMetadata;
	status?: {
		conditions?: { type?: string; status?: string }[];
		containerStatuses?: {
			name?: string;
			ready?: boolean;
			restartCount?: number;
		}[];
		initContainerStatuses?: {
			name?: string;
			ready?: boolean;
			restartCount?: number;
		}[];
	};
}

interface KubernetesEndpoints {
	metadata?: KubernetesMetadata;
	subsets?: { addresses?: unknown[] }[];
}

interface KubernetesIngress {
	metadata?: KubernetesMetadata;
	spec?: {
		rules?: {
			host?: string;
			http?: {
				paths?: {
					backend?: { service?: { name?: string; port?: { number?: number } } };
				}[];
			};
		}[];
	};
}

interface KubernetesList<T> {
	items?: T[];
}

const SEVERE_LOG_PATTERN =
	/\b(?:fatal|panic|uncaught|unhandled)\b|traceback|segmentation fault|crashloopbackoff/gi;

function parseKubectlJson<T>(value: string): T {
	return JSON.parse(value) as T;
}

function createLabelSelector(
	labels: Record<string, string> | undefined,
): string | null {
	if (!labels) return null;
	const entries = Object.entries(labels);
	if (entries.length === 0) return null;
	return entries.map(([key, value]) => `${key}=${value}`).join(",");
}

function countReadyAddresses(endpoints: KubernetesEndpoints): number {
	return (endpoints.subsets ?? []).reduce(
		(total, subset) => total + (subset.addresses?.length ?? 0),
		0,
	);
}

async function countSevereLogs(
	pods: KubernetesPod[],
	namespace: string,
): Promise<number> {
	const requests: Promise<string>[] = [];
	for (const pod of pods) {
		if (!pod.metadata?.name) continue;
		requests.push(
			kubectl([
				"logs",
				`pod/${pod.metadata.name}`,
				"-n",
				namespace,
				"--all-containers=true",
				"--since=10m",
				"--tail=300",
			]),
		);
	}
	const results = await Promise.allSettled(requests);
	if (results.some((result) => result.status === "rejected"))
		return Number.POSITIVE_INFINITY;
	let count = 0;
	for (const result of results) {
		if (result.status !== "fulfilled") continue;
		SEVERE_LOG_PATTERN.lastIndex = 0;
		count += result.value.match(SEVERE_LOG_PATTERN)?.length ?? 0;
	}
	return count;
}

async function readSealosClusterSnapshot(
	state: SealosDeploymentState,
	appUrl: URL,
): Promise<{ snapshot: SealosClusterSnapshot; expectedPort: number | null }> {
	const { app_name: appName, namespace } = state.last_deploy;
	const deployment = parseKubectlJson<KubernetesDeployment>(
		await kubectl([
			"get",
			`deployment/${appName}`,
			"-n",
			namespace,
			"-o",
			"json",
		]),
	);
	const selector = createLabelSelector(deployment.spec?.selector?.matchLabels);
	const [podsPayload, endpointsPayload, ingressesPayload] = await Promise.all([
		kubectl([
			"get",
			"pods",
			"-n",
			namespace,
			...(selector ? ["-l", selector] : []),
			"-o",
			"json",
		]),
		kubectl(["get", "endpoints", "-n", namespace, "-o", "json"]),
		kubectl(["get", "ingress", "-n", namespace, "-o", "json"]),
	]);
	const pods =
		parseKubectlJson<KubernetesList<KubernetesPod>>(podsPayload).items ?? [];
	const endpoints =
		parseKubectlJson<KubernetesList<KubernetesEndpoints>>(endpointsPayload)
			.items ?? [];
	const ingresses =
		parseKubectlJson<KubernetesList<KubernetesIngress>>(ingressesPayload)
			.items ?? [];
	const ingress = ingresses.find((candidate) =>
		candidate.spec?.rules?.some(
			(rule) => rule.host?.toLowerCase() === appUrl.hostname.toLowerCase(),
		),
	);
	const publicBackends = new Map<string, number | null>();
	for (const rule of ingress?.spec?.rules ?? []) {
		for (const ingressPath of rule.http?.paths ?? []) {
			const service = ingressPath.backend?.service;
			if (service?.name)
				publicBackends.set(service.name, service.port?.number ?? null);
		}
	}
	const publicEndpoints = endpoints.filter((candidate) =>
		candidate.metadata?.name
			? publicBackends.has(candidate.metadata.name)
			: false,
	);
	const desiredReplicas = deployment.spec?.replicas ?? 1;
	const generation = deployment.metadata?.generation ?? 0;
	const deploymentReady =
		desiredReplicas > 0 &&
		(deployment.status?.observedGeneration ?? 0) >= generation &&
		(deployment.status?.availableReplicas ?? 0) >= desiredReplicas &&
		(deployment.status?.updatedReplicas ?? 0) >= desiredReplicas;
	const podUids = pods
		.flatMap((pod) => (pod.metadata?.uid ? [pod.metadata.uid] : []))
		.sort();
	const restarts: Record<string, number> = {};
	let podsReady = pods.length >= desiredReplicas;
	for (const pod of pods) {
		const podReady = pod.status?.conditions?.some(
			(condition) => condition.type === "Ready" && condition.status === "True",
		);
		podsReady = podsReady && Boolean(podReady);
		for (const container of [
			...(pod.status?.initContainerStatuses ?? []),
			...(pod.status?.containerStatuses ?? []),
		]) {
			if (pod.metadata?.uid && container.name) {
				restarts[`${pod.metadata.uid}/${container.name}`] =
					container.restartCount ?? 0;
			}
		}
	}
	const severeLogCount = await countSevereLogs(pods, namespace);
	return {
		snapshot: {
			deploymentReady,
			podsReady,
			endpointsReady:
				publicEndpoints.length > 0 &&
				publicEndpoints.every(
					(candidate) => countReadyAddresses(candidate) > 0,
				),
			ingressReady: Boolean(ingress && publicBackends.size > 0),
			podUids,
			restarts,
			severeLogCount,
		},
		expectedPort: publicBackends.values().next().value ?? null,
	};
}

export function isSealosClusterStable(
	baseline: SealosClusterSnapshot,
	final: SealosClusterSnapshot,
): boolean {
	if (!baseline.deploymentReady || !baseline.podsReady) return false;
	if (!final.deploymentReady || !final.podsReady) return false;
	if (baseline.podUids.join("\0") !== final.podUids.join("\0")) return false;
	const restartKeys = new Set([
		...Object.keys(baseline.restarts),
		...Object.keys(final.restarts),
	]);
	for (const key of restartKeys) {
		if ((baseline.restarts[key] ?? 0) !== (final.restarts[key] ?? 0))
			return false;
	}
	return true;
}

async function verifyLaunchpadNetwork(
	state: SealosDeploymentState,
	appUrl: URL,
	expectedPort: number | null,
): Promise<{ ok: boolean; detail: string }> {
	const kubeconfig = await readFile(
		path.join(os.homedir(), ".sealos", "kubeconfig"),
		"utf8",
	);
	const auth = await readStoredAuth();
	if (!auth.region)
		throw new Error("Sealos authentication is missing a region");
	const endpoint = createSealosLaunchpadUrl(
		auth.region,
		state.last_deploy.app_name,
	);
	const response = await fetchWithRetry(() =>
		palotFetch(endpoint, {
			headers: { Authorization: encodeURIComponent(kubeconfig) },
			signal: AbortSignal.timeout(15_000),
		}),
	);
	const payload = (await response.json()) as {
		code?: number;
		data?: {
			networks?: {
				openPublicDomain?: boolean;
				publicDomain?: string;
				customDomain?: string;
				domain?: string;
				port?: number;
			}[];
		};
	};
	const networks = payload.data?.networks ?? [];
	const host = appUrl.hostname.toLowerCase();
	const matching = networks.find((network) => {
		if (!network.openPublicDomain) return false;
		const hosts = [
			network.publicDomain && network.domain
				? `${network.publicDomain}.${network.domain}`.toLowerCase()
				: null,
			network.customDomain?.toLowerCase() ?? null,
		];
		return (
			hosts.includes(host) &&
			(expectedPort === null || network.port === expectedPort)
		);
	});
	const ok = response.ok && payload.code === 200 && Boolean(matching);
	return {
		ok,
		detail: ok
			? `Launchpad exposes ${host}${expectedPort ? ` on port ${expectedPort}` : ""}`
			: "Launchpad public network does not match the application URL and Service port",
	};
}

async function getCurrentNamespace(auth: StoredSealosAuth): Promise<string> {
	try {
		const namespace = await kubectl([
			"config",
			"view",
			"--minify",
			"-o",
			"jsonpath={.contexts[0].context.namespace}",
		]);
		if (namespace) return namespace;
	} catch {
		// Fall back to the workspace recorded during Sealos authentication.
	}
	if (auth.current_workspace?.id) return auth.current_workspace.id;
	throw new Error("The current Sealos workspace is unknown");
}

export async function updateSealosDeployment(
	directory: string,
): Promise<SealosUpdateResult> {
	const state = await readSealosDeploymentState(directory);
	if (!state)
		throw new Error("No previous Sealos deployment was found for this project");
	const templatePath = path.join(
		path.resolve(directory),
		".sealos",
		"template",
		"index.yaml",
	);
	const image = getTemplateImage(await readFile(templatePath, "utf8"));
	if (!image)
		throw new Error(
			"The Sealos template does not contain an application image",
		);
	const {
		app_name: appName,
		namespace,
		image: previousImage,
	} = state.last_deploy;
	const deploymentJson = JSON.parse(
		await kubectl([
			"get",
			`deployment/${appName}`,
			"-n",
			namespace,
			"-o",
			"json",
		]),
	) as {
		spec?: { template?: { spec?: { containers?: { name?: string }[] } } };
	};
	const container = deploymentJson.spec?.template?.spec?.containers?.[0]?.name;
	if (!container)
		throw new Error(
			"The existing Sealos deployment has no application container",
		);
	const now = new Date().toISOString();
	try {
		await kubectl([
			"set",
			"image",
			`deployment/${appName}`,
			`${container}=${image}`,
			"-n",
			namespace,
		]);
		await kubectl([
			"rollout",
			"status",
			`deployment/${appName}`,
			"-n",
			namespace,
			"--timeout=180s",
		]);
		state.last_deploy.image = image;
		state.last_deploy.last_updated_at = now;
		state.history.push({
			at: now,
			action: "set-image",
			status: "success",
			method: "kubectl-set-image",
			image,
			previous_image: previousImage,
		});
		await writeSealosDeploymentState(directory, state);
		return {
			success: true,
			appName,
			image,
			previousImage,
			url: state.last_deploy.url,
		};
	} catch (error) {
		await kubectl([
			"rollout",
			"undo",
			`deployment/${appName}`,
			"-n",
			namespace,
		]).catch(() => "");
		state.history.push({
			at: now,
			action: "set-image",
			status: "failed",
			method: "kubectl-set-image",
			image,
			previous_image: previousImage,
			note:
				error instanceof Error
					? error.message
					: "Rollout failed and was rolled back",
		});
		await writeSealosDeploymentState(directory, state);
		throw error;
	}
}

function findAppUrl(value: unknown, seen = new Set<unknown>()): string | null {
	if (typeof value === "string") {
		try {
			const url = new URL(value);
			return url.protocol === "https:" && !url.hostname.startsWith("template.")
				? url.href
				: null;
		} catch {
			return null;
		}
	}
	if (!value || typeof value !== "object" || seen.has(value)) return null;
	seen.add(value);
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		if (/^(app_?url|url|domain)$/i.test(key)) {
			const direct = findAppUrl(child, seen);
			if (direct) return direct;
		}
	}
	for (const child of Object.values(value as Record<string, unknown>)) {
		const nested = findAppUrl(child, seen);
		if (nested) return nested;
	}
	return null;
}

async function postTemplate(
	deployUrl: string,
	kubeconfig: string,
	yaml: string,
	args: Record<string, string>,
	dryRun: boolean,
): Promise<{ status: number; payload: unknown }> {
	const response = await palotFetch(deployUrl, {
		method: "POST",
		headers: {
			Authorization: encodeURIComponent(kubeconfig),
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ yaml, args, dryRun }),
	});
	const responseText = await response.text();
	let payload: unknown = responseText;
	try {
		payload = responseText ? JSON.parse(responseText) : null;
	} catch {
		// Preserve a non-JSON response for diagnostics.
	}
	if (!response.ok)
		throw new Error(
			`Sealos deployment failed (${response.status}): ${responseText}`,
		);
	return { status: response.status, payload };
}

function findInstanceName(value: unknown): string | null {
	if (!value || typeof value !== "object") return null;
	const record = value as Record<string, unknown>;
	if (record.resourceType === "instance" && typeof record.name === "string")
		return record.name;
	for (const child of Object.values(record)) {
		const found = findInstanceName(child);
		if (found) return found;
	}
	return null;
}

export async function deployToSealos(
	directory: string,
	args: Record<string, string> = {},
): Promise<SealosDeployResult> {
	if (await readSealosDeploymentState(directory)) {
		throw new Error(
			"This project already has a Sealos deployment. Use Update deployment instead.",
		);
	}
	const sealosDirectory = path.join(os.homedir(), ".sealos");
	const logDirectory = path.join(sealosDirectory, "logs");
	await mkdir(logDirectory, { recursive: true });
	const timestamp = new Date()
		.toISOString()
		.replace(/[-:]/g, "")
		.replace(/\..+$/, "")
		.replace("T", "-");
	const logPath = path.join(logDirectory, `deploy-${timestamp}.log`);
	await writeFile(
		logPath,
		`[${new Date().toISOString()}] Deploy started\n`,
		"utf8",
	);
	const templatePath = path.join(
		path.resolve(directory),
		".sealos",
		"template",
		"index.yaml",
	);
	const [authText, kubeconfig, yaml] = await Promise.all([
		readFile(path.join(sealosDirectory, "auth.json"), "utf8"),
		readFile(path.join(sealosDirectory, "kubeconfig"), "utf8"),
		readFile(templatePath, "utf8"),
	]);
	const auth = JSON.parse(authText) as StoredSealosAuth;
	if (!auth.region)
		throw new Error("Sealos authentication is missing a region");
	const regionUrl = new URL(normalizeRegion(auth.region));
	const deployUrl = `https://template.${regionUrl.host}/api/v2alpha/templates/raw`;
	try {
		await appendFile(
			logPath,
			`[${new Date().toISOString()}] === Phase 5: Template dry-run ===\n`,
		);
		await postTemplate(deployUrl, kubeconfig, yaml, args, true);
		await appendFile(
			logPath,
			`[${new Date().toISOString()}] Dry-run accepted\n`,
		);
		await appendFile(
			logPath,
			`[${new Date().toISOString()}] === Phase 6: Deploy ===\n`,
		);
		const result = await postTemplate(deployUrl, kubeconfig, yaml, args, false);
		const appUrl = findAppUrl(result.payload);
		const instanceName = findInstanceName(result.payload);
		await appendFile(
			logPath,
			`[${new Date().toISOString()}] Deployment accepted${appUrl ? `: ${appUrl}` : ""}\n`,
		);
		if (instanceName) {
			const image = getTemplateImage(yaml);
			if (!image)
				throw new Error(
					"Deployment succeeded but its image could not be recorded",
				);
			const now = new Date().toISOString();
			const namespace = await getCurrentNamespace(auth);
			await writeSealosDeploymentState(directory, {
				version: "1.0",
				last_deploy: {
					app_name: instanceName,
					namespace,
					region: regionUrl.host,
					image,
					repo_name: path.basename(path.resolve(directory)),
					url: appUrl,
					deployed_at: now,
					last_updated_at: now,
				},
				history: [
					{
						at: now,
						action: "deploy",
						status: "success",
						method: "template-api",
						image,
					},
				],
			});
		}
		return {
			success: true,
			status: result.status,
			region: regionUrl.origin,
			response: result.payload,
			appUrl,
			instanceName,
			logPath,
		};
	} catch (error) {
		await appendFile(
			logPath,
			`[${new Date().toISOString()}] ERROR: ${error instanceof Error ? error.message : String(error)}\n`,
		);
		throw error;
	}
}

export async function verifySealosRuntime(
	directory: string,
	url: string,
): Promise<SealosRuntimeResult> {
	const parsed = new URL(url);
	if (parsed.protocol !== "https:")
		throw new Error("Only HTTPS application URLs can be verified");
	try {
		const state = await readSealosDeploymentState(directory);
		if (!state)
			throw new Error("No Sealos deployment state was found for this project");
		await kubectl([
			"rollout",
			"status",
			`deployment/${state.last_deploy.app_name}`,
			"-n",
			state.last_deploy.namespace,
			"--timeout=180s",
		]);
		const baseline = await readSealosClusterSnapshot(state, parsed);
		const launchpad = await verifyLaunchpadNetwork(
			state,
			parsed,
			baseline.expectedPort,
		);
		const missingPath = `/__palot_missing_${Date.now()}`;
		const [root, health, missing] = await Promise.all([
			fetchWithRetry(() =>
				palotFetch(parsed, {
					redirect: "follow",
					signal: AbortSignal.timeout(15_000),
				}),
			),
			fetchWithRetry(() =>
				palotFetch(new URL("/health", parsed), {
					redirect: "follow",
					signal: AbortSignal.timeout(15_000),
				}),
			),
			fetchWithRetry(() =>
				palotFetch(new URL(missingPath, parsed), {
					redirect: "manual",
					signal: AbortSignal.timeout(15_000),
				}),
			),
		]);
		const body = (await root.text()).slice(0, 64_000);
		const failureText =
			/Application error|server-side exception|Internal Server Error|Unhandled Runtime Error/i.test(
				body,
			);
		await new Promise((resolve) => setTimeout(resolve, 60_000));
		const final = await readSealosClusterSnapshot(state, parsed);
		const clusterStable = isSealosClusterStable(
			baseline.snapshot,
			final.snapshot,
		);
		const checks: SealosRuntimeResult["checks"] = [
			{
				id: "deployment",
				ok: final.snapshot.deploymentReady && final.snapshot.podsReady,
				detail:
					final.snapshot.deploymentReady && final.snapshot.podsReady
						? "Deployment and Pods are Ready"
						: "Deployment or Pods are not Ready",
			},
			{
				id: "endpoints",
				ok: final.snapshot.endpointsReady,
				detail: final.snapshot.endpointsReady
					? "Public Service has ready endpoints"
					: "Public Service has no ready endpoints",
			},
			{
				id: "ingress",
				ok: final.snapshot.ingressReady,
				detail: final.snapshot.ingressReady
					? `Ingress routes ${parsed.hostname} to the application Service`
					: "Ingress does not match the public application URL",
			},
			{ id: "launchpad", ok: launchpad.ok, detail: launchpad.detail },
			{
				id: "root",
				ok: root.status >= 200 && root.status < 300,
				detail: `Root returned HTTP ${root.status}`,
			},
			{
				id: "health",
				ok: health.status >= 200 && health.status < 300,
				detail: `/health returned HTTP ${health.status}`,
			},
			{
				id: "missing-path",
				ok: missing.status === 404,
				detail: `Random missing path returned HTTP ${missing.status}`,
			},
			{
				id: "failure-text",
				ok: !failureText,
				detail: failureText
					? "Failure text found in the rendered page"
					: "No browser failure text found",
			},
			{
				id: "logs",
				ok:
					Number.isFinite(final.snapshot.severeLogCount) &&
					final.snapshot.severeLogCount === 0,
				detail:
					final.snapshot.severeLogCount === 0
						? "Recent container logs contain no severe runtime failures"
						: "Recent container logs contain severe failures or could not be read",
			},
			{
				id: "stability",
				ok: clusterStable,
				detail: clusterStable
					? "Pods stayed Ready with no replacement or restart delta for 60 seconds"
					: "Pods changed readiness, identity, or restart count during the 60-second window",
			},
		];
		const acceptable = checks.every((check) => check.ok);
		return {
			ok: acceptable,
			status: root.status,
			url: root.url || parsed.href,
			detail: acceptable
				? "Public runtime checks passed"
				: "One or more runtime checks failed",
			checks,
		};
	} catch (error) {
		return {
			ok: false,
			status: null,
			url: parsed.href,
			detail:
				error instanceof Error ? error.message : "Runtime verification failed",
			checks: [],
		};
	}
}
