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
		assert.equal(config.providerBaseUrls.deepseek, "https://api.deepseek.com")
		assert.equal(config.providerCredentials.deepseek, null)
	})

	it("rejects missing secrets and unsafe upstream URLs", () => {
		assert.throws(() => readGatewayConfig({}), /DATABASE_URL is required/)
		assert.throws(
			() => readGatewayConfig({ ...requiredEnvironment, DEEPSEEK_BASE_URL: "http://proxy.test" }),
			/must use HTTPS/,
		)
		assert.throws(
			() => readGatewayConfig({ ...requiredEnvironment, PALOT_TOKEN_PEPPER: "short" }),
			/at least 32/,
		)
	})
})
