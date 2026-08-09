/**
 * Environment validation for the Palot Cloud gateway.
 */

import type { UpstreamProviderId } from "./models"
import { DEFAULT_MARKUP_BASIS_POINTS } from "./pricing"

export interface GatewayConfig {
	databaseUrl: string
	tokenPepper: string
	port: number
	markupBasisPoints: number
	providerCredentials: Record<UpstreamProviderId, string | null>
	providerBaseUrls: Record<UpstreamProviderId, string>
}

function requireEnvironment(environment: NodeJS.ProcessEnv, name: string): string {
	const value = environment[name]?.trim()
	if (!value) throw new Error(`${name} is required`)
	return value
}

function resolveDatabaseUrl(environment: NodeJS.ProcessEnv): string {
	const explicitUrl = environment.DATABASE_URL?.trim()
	if (explicitUrl) return explicitUrl
	if (!environment.PALOT_POSTGRES_HOST?.trim()) {
		throw new Error("DATABASE_URL or PALOT_POSTGRES_HOST is required")
	}
	const host = requireEnvironment(environment, "PALOT_POSTGRES_HOST")
	const port = Number(requireEnvironment(environment, "PALOT_POSTGRES_PORT"))
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		throw new Error("PALOT_POSTGRES_PORT must be an integer between 1 and 65535")
	}
	const username = requireEnvironment(environment, "PALOT_POSTGRES_USERNAME")
	const password = requireEnvironment(environment, "PALOT_POSTGRES_PASSWORD")
	const database = environment.PALOT_POSTGRES_DATABASE?.trim() || "postgres"
	return `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}`
}

function normalizeHttpsUrl(value: string, name: string): string {
	const url = new URL(value)
	if (url.protocol !== "https:") throw new Error(`${name} must use HTTPS`)
	if (url.username || url.password || url.search || url.hash) {
		throw new Error(`${name} cannot contain credentials, a query string, or a fragment`)
	}
	return url.toString().replace(/\/$/, "")
}

export function readGatewayConfig(environment: NodeJS.ProcessEnv = process.env): GatewayConfig {
	const databaseUrl = resolveDatabaseUrl(environment)
	const tokenPepper = requireEnvironment(environment, "PALOT_TOKEN_PEPPER")
	if (tokenPepper.length < 32) {
		throw new Error("PALOT_TOKEN_PEPPER must contain at least 32 characters")
	}
	const port = Number(environment.PORT ?? "8080")
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		throw new Error("PORT must be an integer between 1 and 65535")
	}
	const markupBasisPoints = Number(
		environment.PALOT_MARKUP_BASIS_POINTS ?? DEFAULT_MARKUP_BASIS_POINTS,
	)
	if (
		!Number.isInteger(markupBasisPoints) ||
		markupBasisPoints < 0 ||
		markupBasisPoints > 100_000
	) {
		throw new Error("PALOT_MARKUP_BASIS_POINTS must be an integer between 0 and 100000")
	}
	return {
		databaseUrl,
		tokenPepper,
		port,
		markupBasisPoints,
		providerCredentials: {
			deepseek: environment.DEEPSEEK_API_KEY?.trim() || null,
			zhipuai: environment.ZHIPUAI_API_KEY?.trim() || null,
		},
		providerBaseUrls: {
			deepseek: normalizeHttpsUrl(
				environment.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
				"DEEPSEEK_BASE_URL",
			),
			zhipuai: normalizeHttpsUrl(
				environment.ZHIPUAI_BASE_URL ?? "https://open.bigmodel.cn/api/paas/v4",
				"ZHIPUAI_BASE_URL",
			),
		},
	}
}
