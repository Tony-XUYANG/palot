import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
	CHINA_PROVIDER_IDS,
	CHINA_RECOMMENDED_MODELS,
	CODEX_PROVIDER_IDS,
	CODEX_RECOMMENDED_MODELS,
	GLOBAL_PROVIDER_IDS,
	isChinaProvider,
	isCodexProvider,
	POPULAR_PROVIDER_IDS,
	PROVIDER_KEY_URLS,
} from "./providers.ts"

describe("provider recommendations", () => {
	it("keeps provider groups unique", () => {
		const allIds = [
			"opencode",
			...CODEX_PROVIDER_IDS,
			...CHINA_PROVIDER_IDS,
			...GLOBAL_PROVIDER_IDS,
		]
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

	it("features OpenAI as a Codex provider with official key and model entries", () => {
		for (const providerId of CODEX_PROVIDER_IDS) {
			assert.equal(isCodexProvider(providerId), true)
			assert.match(PROVIDER_KEY_URLS[providerId]?.url ?? "", /^https:\/\//)
			assert.equal(isChinaProvider(providerId), false)
		}
		for (const model of CODEX_RECOMMENDED_MODELS) {
			assert.equal(isCodexProvider(model.providerID), true)
			assert.match(model.modelID, /codex/)
		}
	})

	it("keeps China model recommendations unique and scoped to China providers", () => {
		const modelKeys = CHINA_RECOMMENDED_MODELS.map(
			(model) => `${model.providerID}/${model.modelID}`,
		)
		assert.equal(new Set(modelKeys).size, modelKeys.length)
		for (const model of CHINA_RECOMMENDED_MODELS) {
			assert.equal(isChinaProvider(model.providerID), true)
			assert.ok(model.modelID.length > 0)
		}
	})
})
