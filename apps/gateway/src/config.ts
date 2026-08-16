/**
 * Environment validation for the Palot Cloud gateway.
 */

import { createPrivateKey, createPublicKey } from "node:crypto"
import type { AlipayConfig } from "./alipay"
import type { UpstreamProviderId } from "./models"
import type { PaymentChannel } from "./payments"
import { DEFAULT_MARKUP_BASIS_POINTS } from "./pricing"

export interface GatewayConfig {
	databaseUrl: string
	tokenPepper: string
	port: number
	markupBasisPoints: number
	upstreamTimeoutMs: number
	reservationTtlMs: number
	paymentMode: "disabled" | PaymentChannel
	publicUrl: string | null
	alipay: AlipayConfig | null
	providerCredentials: Record<UpstreamProviderId, string | null>
	providerBaseUrls: Record<UpstreamProviderId, string>
}

const DEFAULT_UPSTREAM_TIMEOUT_MS = 5 * 60 * 1_000
const DEFAULT_RESERVATION_TTL_MS = 15 * 60 * 1_000

function readDuration(
	environment: NodeJS.ProcessEnv,
	name: string,
	fallback: number,
	minimum: number,
): number {
	const value = Number(environment[name] ?? fallback)
	if (!Number.isInteger(value) || value < minimum || value > 24 * 60 * 60 * 1_000) {
		throw new Error(`${name} must be an integer between ${minimum} and 86400000`)
	}
	return value
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

function readPem(environment: NodeJS.ProcessEnv, name: string): string {
	return requireEnvironment(environment, name).replace(/\\n/g, "\n")
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
	const upstreamTimeoutMs = readDuration(
		environment,
		"PALOT_UPSTREAM_TIMEOUT_MS",
		DEFAULT_UPSTREAM_TIMEOUT_MS,
		1_000,
	)
	const reservationTtlMs = readDuration(
		environment,
		"PALOT_RESERVATION_TTL_MS",
		DEFAULT_RESERVATION_TTL_MS,
		upstreamTimeoutMs + 1,
	)
	const paymentMode = environment.PALOT_PAYMENT_MODE?.trim() || "disabled"
	if (paymentMode !== "disabled" && paymentMode !== "sandbox" && paymentMode !== "alipay") {
		throw new Error("PALOT_PAYMENT_MODE must be disabled, sandbox, or alipay")
	}
	const publicUrl =
		paymentMode === "disabled"
			? null
			: normalizeHttpsUrl(requireEnvironment(environment, "PALOT_PUBLIC_URL"), "PALOT_PUBLIC_URL")
	const alipay =
		paymentMode === "alipay"
			? {
					appId: requireEnvironment(environment, "ALIPAY_APP_ID"),
					sellerId: requireEnvironment(environment, "ALIPAY_SELLER_ID"),
					privateKey: readPem(environment, "ALIPAY_PRIVATE_KEY"),
					publicKey: readPem(environment, "ALIPAY_PUBLIC_KEY"),
					gatewayUrl: normalizeHttpsUrl(
						environment.ALIPAY_GATEWAY_URL ?? "https://openapi.alipay.com/gateway.do",
						"ALIPAY_GATEWAY_URL",
					),
					publicUrl: publicUrl!,
				}
			: null
	if (alipay) {
		try {
			createPrivateKey(alipay.privateKey)
			createPublicKey(alipay.publicKey)
		} catch {
			throw new Error("Alipay RSA key material is invalid")
		}
	}
	return {
		databaseUrl,
		tokenPepper,
		port,
		markupBasisPoints,
		upstreamTimeoutMs,
		reservationTtlMs,
		paymentMode,
		publicUrl,
		alipay,
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
