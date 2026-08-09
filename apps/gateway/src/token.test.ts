import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
	accessTokenHashMatches,
	generateAccessToken,
	hashAccessToken,
	parseAccessTokenPrefix,
} from "./token"

describe("Palot access tokens", () => {
	it("generates opaque tokens and stores only a one-way hash", () => {
		const token = generateAccessToken("p".repeat(32))
		assert.match(token.raw, /^palot_live_[a-f0-9]{12}_[A-Za-z0-9_-]{43}$/)
		assert.equal(parseAccessTokenPrefix(token.raw), token.prefix)
		assert.equal(token.hash, hashAccessToken(token.raw, "p".repeat(32)))
		assert.equal(accessTokenHashMatches(token.raw, token.hash, "p".repeat(32)), true)
		assert.equal(accessTokenHashMatches(`${token.raw}x`, token.hash, "p".repeat(32)), false)
	})

	it("rejects malformed credentials before repository lookup", () => {
		assert.equal(parseAccessTokenPrefix("sk-project-secret"), null)
		assert.equal(parseAccessTokenPrefix("palot_live_short_secret"), null)
	})
})
