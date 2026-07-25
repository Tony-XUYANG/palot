import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { formatModelError, formatRequestError } from "./model-errors.ts"

describe("model error formatting", () => {
	it("turns authentication failures into a settings action", () => {
		assert.equal(
			formatModelError({
				name: "ProviderAuthError",
				data: { providerID: "deepseek", message: "invalid key" },
			}),
			"Authentication failed for the selected provider. Check the API key in Settings > Providers.",
		)
	})

	it("classifies billing and rate-limit API responses", () => {
		assert.match(
			formatModelError({
				name: "APIError",
				data: { message: "Insufficient balance", statusCode: 402, isRetryable: false },
			}),
			/Top up the account/,
		)
		assert.match(
			formatModelError({
				name: "APIError",
				data: { message: "Too many requests", statusCode: 429, isRetryable: true },
			}),
			/Rate limit reached/,
		)
	})

	it("keeps unknown request errors useful", () => {
		assert.equal(formatRequestError(new Error("Connection refused")), "Connection refused")
	})
})
