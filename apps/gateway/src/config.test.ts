import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { readGatewayConfig } from "./config"

const requiredEnvironment: NodeJS.ProcessEnv = {
	DATABASE_URL: "postgresql://palot@example.test/palot",
	PALOT_TOKEN_PEPPER: "p".repeat(32),
}

describe("Palot Cloud environment", () => {
	it("uses secure provider defaults and the 30 percent markup", () => {
		const config = readGatewayConfig(requiredEnvironment)
		assert.equal(config.port, 8080)
		assert.equal(config.markupBasisPoints, 3_000)
		assert.equal(config.upstreamTimeoutMs, 300_000)
		assert.equal(config.reservationTtlMs, 900_000)
		assert.equal(config.paymentMode, "disabled")
		assert.equal(config.publicUrl, null)
		assert.equal(config.providerBaseUrls.deepseek, "https://api.deepseek.com")
		assert.equal(config.providerCredentials.deepseek, null)
	})

	it("rejects missing secrets and unsafe upstream URLs", () => {
		assert.throws(() => readGatewayConfig({}), /DATABASE_URL or PALOT_POSTGRES_HOST is required/)
		assert.throws(
			() => readGatewayConfig({ ...requiredEnvironment, DEEPSEEK_BASE_URL: "http://proxy.test" }),
			/must use HTTPS/,
		)
		assert.throws(
			() => readGatewayConfig({ ...requiredEnvironment, PALOT_TOKEN_PEPPER: "short" }),
			/at least 32/,
		)
		assert.throws(
			() =>
				readGatewayConfig({
					...requiredEnvironment,
					PALOT_UPSTREAM_TIMEOUT_MS: "300000",
					PALOT_RESERVATION_TTL_MS: "300000",
				}),
			/PALOT_RESERVATION_TTL_MS/,
		)
		assert.throws(
			() => readGatewayConfig({ ...requiredEnvironment, PALOT_PAYMENT_MODE: "sandbox" }),
			/PALOT_PUBLIC_URL/,
		)
		const sandbox = readGatewayConfig({
			...requiredEnvironment,
			PALOT_PAYMENT_MODE: "sandbox",
			PALOT_PUBLIC_URL: "https://cloud.example.test",
		})
		assert.equal(sandbox.paymentMode, "sandbox")
		assert.equal(sandbox.publicUrl, "https://cloud.example.test")
		assert.throws(
			() =>
				readGatewayConfig({
					...requiredEnvironment,
					PALOT_PAYMENT_MODE: "alipay",
					PALOT_PUBLIC_URL: "https://cloud.example.test",
					ALIPAY_APP_ID: "app-id",
					ALIPAY_SELLER_ID: "seller-id",
					ALIPAY_PRIVATE_KEY: "not-a-private-key",
					ALIPAY_PUBLIC_KEY: "not-a-public-key",
				}),
			/Alipay RSA key material is invalid/,
		)
	})

	it("builds a safe database URL from Sealos secret fields", () => {
		const config = readGatewayConfig({
			PALOT_POSTGRES_HOST: "postgres.internal",
			PALOT_POSTGRES_PORT: "5432",
			PALOT_POSTGRES_USERNAME: "palot user",
			PALOT_POSTGRES_PASSWORD: "p@ss:/word",
			PALOT_POSTGRES_DATABASE: "palot cloud",
			PALOT_TOKEN_PEPPER: "p".repeat(32),
		})
		assert.equal(
			config.databaseUrl,
			"postgresql://palot%20user:p%40ss%3A%2Fword@postgres.internal:5432/palot%20cloud",
		)
	})
})
