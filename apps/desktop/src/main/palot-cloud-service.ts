/**
 * Main-process Palot Cloud lifecycle, encrypted credentials, and loopback provider setup.
 */

import path from "node:path"
import { app, net, safeStorage } from "electron"
import type {
	PalotCloudAccountInfo,
	PalotCloudConnectionResult,
	PalotCloudModelInfo,
	PalotCloudProviderSetup,
	PalotCloudStatus,
	PalotCloudUsageInfo,
} from "../preload/api"
import cloudManifest from "../../palot-cloud-manifest.json"
import { getDataDir } from "./automation/paths"
import { startPalotCloudProxy, type PalotCloudProxy } from "./palot-cloud-proxy"
import { PalotCloudTokenStore } from "./palot-cloud-token-store"

const PROVIDER_ID = "palot-cloud" as const
const TOKEN_PATTERN = /^palot_live_[a-f0-9]{12}_[A-Za-z0-9_-]{43}$/

interface ManifestShape {
	schemaVersion: number
	enabled: boolean
	gatewayUrl: string | null
}

function normalizeGatewayUrl(value: string, allowLoopback: boolean): string {
	const url = new URL(value)
	const isLoopback = url.hostname === "localhost" || url.hostname === "127.0.0.1"
	if (url.protocol !== "https:" && !(allowLoopback && isLoopback && url.protocol === "http:")) {
		throw new Error("Palot Cloud gateway must use HTTPS")
	}
	if (url.username || url.password || url.search || url.hash) {
		throw new Error("Palot Cloud gateway URL is invalid")
	}
	return url.toString().replace(/\/$/, "")
}

function resolveGatewayUrl(): string | null {
	const manifest = cloudManifest as ManifestShape
	if (manifest.schemaVersion !== 1) throw new Error("Palot Cloud manifest is incompatible")
	if (!app.isPackaged && process.env.PALOT_TEST_CLOUD_GATEWAY_URL) {
		return normalizeGatewayUrl(process.env.PALOT_TEST_CLOUD_GATEWAY_URL, true)
	}
	if (!manifest.enabled || !manifest.gatewayUrl) return null
	return normalizeGatewayUrl(manifest.gatewayUrl, false)
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function readString(value: unknown, name: string): string {
	if (typeof value !== "string") throw new Error(`Palot Cloud returned an invalid ${name}`)
	return value
}

function readInteger(value: unknown, name: string): number {
	if (typeof value !== "number" || !Number.isInteger(value)) {
		throw new Error(`Palot Cloud returned an invalid ${name}`)
	}
	return value
}

function parseUsage(value: unknown): PalotCloudUsageInfo | null {
	if (!isRecord(value)) return null
	const usage = isRecord(value.usage)
		? {
				inputTokens: readInteger(value.usage.inputTokens, "input token count"),
				outputTokens: readInteger(value.usage.outputTokens, "output token count"),
				cacheReadTokens: readInteger(value.usage.cacheReadTokens, "cache token count"),
				source: value.usage.source === "provider" ? ("provider" as const) : ("estimated" as const),
			}
		: null
	const state = value.state
	if (state !== "reserved" && state !== "settled" && state !== "refunded") return null
	return {
		id: readString(value.id, "usage id"),
		model: readString(value.model, "usage model"),
		priceVersion: readInteger(value.priceVersion, "price version"),
		state,
		reservedMicros: readString(value.reservedMicros, "reserved amount"),
		chargedMicros: readString(value.chargedMicros, "charged amount"),
		usage,
		createdAt: readString(value.createdAt, "usage timestamp"),
		settledAt: value.settledAt === null ? null : readString(value.settledAt, "settled timestamp"),
	}
}

function parseAccount(value: unknown): PalotCloudAccountInfo {
	if (!isRecord(value) || !Array.isArray(value.recentUsage)) {
		throw new Error("Palot Cloud returned an invalid account")
	}
	const state = value.state
	if (state !== "active" && state !== "frozen") {
		throw new Error("Palot Cloud returned an invalid account state")
	}
	return {
		id: readString(value.id, "account id"),
		name: readString(value.name, "account name"),
		state,
		balanceMicros: readString(value.balanceMicros, "account balance"),
		currency: "CNY",
		recentUsage: value.recentUsage.flatMap((item) => {
			const usage = parseUsage(item)
			return usage ? [usage] : []
		}),
	}
}

function parseModels(value: unknown): PalotCloudModelInfo[] {
	if (!isRecord(value) || !Array.isArray(value.data)) {
		throw new Error("Palot Cloud returned an invalid model catalog")
	}
	return value.data.map((item) => {
		if (!isRecord(item) || !isRecord(item.pricing)) {
			throw new Error("Palot Cloud returned an invalid model")
		}
		return {
			id: readString(item.id, "model id"),
			name: readString(item.name, "model name"),
			pricing: {
				currency: "CNY",
				unit: "million_tokens",
				inputMicros: readString(item.pricing.inputMicros, "input price"),
				outputMicros: readString(item.pricing.outputMicros, "output price"),
				cacheReadMicros: readString(item.pricing.cacheReadMicros, "cache price"),
				version: readInteger(item.pricing.version, "price version"),
			},
		}
	})
}

class PalotCloudService {
	private readonly gatewayUrl = resolveGatewayUrl()
	private readonly tokenStore = new PalotCloudTokenStore(
		path.join(getDataDir(), "palot-cloud-credentials.json"),
		safeStorage,
	)
	private proxy: PalotCloudProxy | null = null

	async status(): Promise<PalotCloudStatus> {
		const token = await this.tokenStore.read()
		if (!token || !this.gatewayUrl) {
			return this.createStatus({ connected: Boolean(token), account: null, models: [] })
		}
		try {
			const [account, models] = await Promise.all([
				this.fetchAccount(token),
				this.fetchModels(token),
			])
			return this.createStatus({ connected: true, account, models })
		} catch (error) {
			return this.createStatus({
				connected: true,
				account: null,
				models: [],
				error: error instanceof Error ? error.message : "Palot Cloud is unavailable",
			})
		}
	}

	async bootstrap(): Promise<PalotCloudConnectionResult> {
		const token = await this.tokenStore.read()
		if (!token || !this.gatewayUrl) return { status: await this.status(), setup: null }
		try {
			const [account, models] = await Promise.all([
				this.fetchAccount(token),
				this.fetchModels(token),
			])
			const setup = await this.startProxy(token, models)
			return { status: this.createStatus({ connected: true, account, models }), setup }
		} catch (error) {
			return {
				status: this.createStatus({
					connected: true,
					account: null,
					models: [],
					error: error instanceof Error ? error.message : "Palot Cloud is unavailable",
				}),
				setup: null,
			}
		}
	}

	async connect(rawToken: string): Promise<PalotCloudConnectionResult> {
		if (!this.gatewayUrl) throw new Error("Palot Cloud is not enabled in this build")
		if (!this.tokenStore.isEncryptionAvailable()) {
			throw new Error("Secure OS credential encryption is unavailable")
		}
		const token = rawToken.trim()
		if (!TOKEN_PATTERN.test(token)) throw new Error("Enter a valid Palot Cloud access token")
		const [account, models] = await Promise.all([
			this.fetchAccount(token),
			this.fetchModels(token),
		])
		const setup = await this.startProxy(token, models)
		try {
			await this.tokenStore.store(token)
		} catch (error) {
			await this.stopProxy()
			throw error
		}
		return { status: this.createStatus({ connected: true, account, models }), setup }
	}

	async disconnect(): Promise<PalotCloudStatus> {
		await this.stopProxy()
		await this.tokenStore.delete()
		return this.createStatus({ connected: false, account: null, models: [] })
	}

	private createStatus(input: {
		connected: boolean
		account: PalotCloudAccountInfo | null
		models: PalotCloudModelInfo[]
		error?: string | null
	}): PalotCloudStatus {
		return {
			available: Boolean(this.gatewayUrl),
			connected: input.connected,
			encryptionAvailable: this.tokenStore.isEncryptionAvailable(),
			gatewayHost: this.gatewayUrl ? new URL(this.gatewayUrl).host : null,
			account: input.account,
			models: input.models,
			error: input.error ?? null,
		}
	}

	private async startProxy(
		token: string,
		models: PalotCloudModelInfo[],
	): Promise<PalotCloudProviderSetup> {
		await this.stopProxy()
		this.proxy = await startPalotCloudProxy({
			gatewayUrl: this.gatewayUrl!,
			cloudToken: token,
			fetch: net.fetch,
		})
		return {
			providerId: PROVIDER_ID,
			baseUrl: this.proxy.baseUrl,
			sessionToken: this.proxy.sessionToken,
			models,
		}
	}

	private async stopProxy(): Promise<void> {
		const proxy = this.proxy
		this.proxy = null
		await proxy?.close()
	}

	private async fetchAccount(token: string): Promise<PalotCloudAccountInfo> {
		return parseAccount(await this.fetchJson("/v1/account", token))
	}

	private async fetchModels(token: string): Promise<PalotCloudModelInfo[]> {
		return parseModels(await this.fetchJson("/v1/models", token))
	}

	private async fetchJson(pathname: string, token: string): Promise<unknown> {
		const response = await net.fetch(`${this.gatewayUrl}${pathname}`, {
			headers: { authorization: `Bearer ${token}` },
			signal: AbortSignal.timeout(10_000),
		})
		if (response.status === 401) throw new Error("Palot Cloud access token is invalid")
		if (response.status === 403) throw new Error("Palot Cloud account is unavailable")
		if (!response.ok) throw new Error(`Palot Cloud returned HTTP ${response.status}`)
		return (await response.json()) as unknown
	}
}

let service: PalotCloudService | null = null

function getService(): PalotCloudService {
	service ??= new PalotCloudService()
	return service
}

export async function getPalotCloudStatus(): Promise<PalotCloudStatus> {
	return await getService().status()
}

export async function bootstrapPalotCloud(): Promise<PalotCloudConnectionResult> {
	return await getService().bootstrap()
}

export async function connectPalotCloud(token: string): Promise<PalotCloudConnectionResult> {
	return await getService().connect(token)
}

export async function disconnectPalotCloud(): Promise<PalotCloudStatus> {
	return await getService().disconnect()
}
