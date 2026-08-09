import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { normalizeProviderBaseUrl } from "./provider-config"

describe("normalizeProviderBaseUrl", () => {
	it("normalizes official and compatible HTTPS endpoints", () => {
		assert.equal(
			normalizeProviderBaseUrl(" https://api.openai.com/v1/ "),
			"https://api.openai.com/v1",
		)
		assert.equal(
			normalizeProviderBaseUrl("https://gateway.example.com/openai/v1"),
			"https://gateway.example.com/openai/v1",
		)
	})

	it("allows loopback HTTP endpoints for local development", () => {
		assert.equal(
			normalizeProviderBaseUrl("http://localhost:4141/v1/"),
			"http://localhost:4141/v1",
		)
		assert.equal(
			normalizeProviderBaseUrl("http://127.0.0.1:4141/v1"),
			"http://127.0.0.1:4141/v1",
		)
	})

	it("rejects unsafe or ambiguous endpoints", () => {
		assert.throws(
			() => normalizeProviderBaseUrl("http://gateway.example.com/v1"),
			/must use HTTPS/,
		)
		assert.throws(
			() => normalizeProviderBaseUrl("https://user:secret@example.com/v1"),
			/cannot include credentials/,
		)
		assert.throws(
			() => normalizeProviderBaseUrl("https://example.com/v1?token=secret"),
			/cannot include a query string/,
		)
	})
})
