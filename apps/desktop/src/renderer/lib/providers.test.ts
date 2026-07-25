import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
	CHINA_PROVIDER_IDS,
	GLOBAL_PROVIDER_IDS,
	isChinaProvider,
	POPULAR_PROVIDER_IDS,
	PROVIDER_KEY_URLS,
} from "./providers.ts"

describe("provider recommendations", () => {
	it("keeps provider groups unique", () => {
		const allIds = ["opencode", ...CHINA_PROVIDER_IDS, ...GLOBAL_PROVIDER_IDS]
		assert.equal(new Set(allIds).size, allIds.length)
		assert.deepEqual([...POPULAR_PROVIDER_IDS], allIds)
	})

	it("provides official key links for every China recommendation", () => {
		for (const providerId of CHINA_PROVIDER_IDS) {
			assert.equal(isChinaProvider(providerId), true)
			assert.match(PROVIDER_KEY_URLS[providerId]?.url ?? "", /^https:\/\//)
		}
	})

	it("does not classify global providers as China recommendations", () => {
		for (const providerId of GLOBAL_PROVIDER_IDS) {
			assert.equal(isChinaProvider(providerId), false)
		}
	})
})
