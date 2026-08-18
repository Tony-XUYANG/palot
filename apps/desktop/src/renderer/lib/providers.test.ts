import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
	CHINA_MODEL_REGISTRY,
	CHINA_PROVIDER_IDS,
	CHINA_RECOMMENDED_MODELS,
	CODEX_PROVIDER_IDS,
	CODEX_RECOMMENDED_MODELS,
	FIRST_TIER_CHINA_PROVIDER_IDS,
	GLOBAL_PROVIDER_IDS,
	isChinaProvider,
	isCodexProvider,
	isVerifiedChinaProvider,
	POPULAR_PROVIDER_IDS,
	PROVIDER_KEY_URLS,
	resolveAvailableChinaModelCandidates,
	resolveAvailableCodexModelCandidates,
	resolveCatalogModelCandidates,
	resolveVerifiedChinaModelCandidates,
	VERIFIED_CHINA_PROVIDER_IDS,
} from "./providers.ts"

describe("provider recommendations", () => {
	it("keeps provider groups unique", () => {
		const allIds = [
			"opencode",
			...CHINA_PROVIDER_IDS,
			...CODEX_PROVIDER_IDS,
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

	it("prioritizes domestic providers that passed real-world acceptance", () => {
		assert.deepEqual(VERIFIED_CHINA_PROVIDER_IDS, ["deepseek", "zhipuai"])
		assert.equal(FIRST_TIER_CHINA_PROVIDER_IDS, VERIFIED_CHINA_PROVIDER_IDS)
		assert.deepEqual(
			CHINA_PROVIDER_IDS.slice(0, FIRST_TIER_CHINA_PROVIDER_IDS.length),
			FIRST_TIER_CHINA_PROVIDER_IDS,
		)
		assert.equal(isVerifiedChinaProvider("deepseek"), true)
		assert.equal(isVerifiedChinaProvider("zhipuai"), true)
		assert.equal(isVerifiedChinaProvider("kimi-for-coding"), false)
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

	it("keeps China model recommendations unique, scoped, and accurately tiered", () => {
		const modelKeys = CHINA_RECOMMENDED_MODELS.map(
			(model) => `${model.providerID}/${model.modelID}`,
		)
		assert.equal(new Set(modelKeys).size, modelKeys.length)
		for (const model of CHINA_RECOMMENDED_MODELS) {
			assert.equal(isChinaProvider(model.providerID), true)
			assert.ok(model.modelID.length > 0)
			assert.equal(
				model.tier,
				isVerifiedChinaProvider(model.providerID) ? "verified" : "candidate",
			)
			assert.equal(
				model.firstTier,
				VERIFIED_CHINA_PROVIDER_IDS.includes(
					model.providerID as (typeof VERIFIED_CHINA_PROVIDER_IDS)[number],
				),
			)
		}
		assert.equal(CHINA_RECOMMENDED_MODELS, CHINA_MODEL_REGISTRY)
	})

	it("intersects candidates with exact live provider model IDs", () => {
		const candidates = [
			{ providerID: "deepseek", modelID: "deepseek-chat", marker: 1 },
			{ providerID: "deepseek", modelID: "missing-model", marker: 2 },
			{ providerID: "missing-provider", modelID: "deepseek-chat", marker: 3 },
			{ providerID: "zhipuai", modelID: "glm-4.7-flash", marker: 4 },
		] as const
		const available = resolveCatalogModelCandidates(candidates, [
			{ id: "deepseek", models: { "deepseek-chat": {} } },
			{ id: "zhipuai", models: { "glm-4.7-flash": {} } },
		])

		assert.deepEqual(
			available.map((candidate) => candidate.marker),
			[1, 4],
		)
		assert.equal(available[0], candidates[0])
		assert.equal(available[1], candidates[3])
	})

	it("resolves domestic candidates from the live catalog without stale recommendations", () => {
		const available = resolveAvailableChinaModelCandidates([
			{ id: "kimi-for-coding", models: { "kimi-for-coding": {} } },
			{ id: "zhipuai", models: { "glm-obsolete": {} } },
			{ id: "deepseek", models: {} },
			{ id: "moonshotai-cn", models: { "kimi-k2.5": {} } },
		])

		assert.deepEqual(
			available.map((candidate) => `${candidate.providerID}/${candidate.modelID}`),
			["kimi-for-coding/kimi-for-coding", "moonshotai-cn/kimi-k2.5"],
		)
	})

	it("resolves additional official domestic coding providers from the live catalog", () => {
		const available = resolveAvailableChinaModelCandidates([
			{ id: "alibaba-coding-plan-cn", models: { "qwen3-coder-next": {} } },
			{ id: "tencent-coding-plan", models: { "tc-code-latest": {} } },
			{ id: "stepfun-step-plan", models: { "step-3.7-flash": {} } },
			{ id: "longcat", models: { "LongCat-2.0": {} } },
		])

		assert.deepEqual(
			available.map((candidate) => `${candidate.providerID}/${candidate.modelID}`),
			[
				"alibaba-coding-plan-cn/qwen3-coder-next",
				"tencent-coding-plan/tc-code-latest",
				"stepfun-step-plan/step-3.7-flash",
				"longcat/LongCat-2.0",
			],
		)
	})

	it("does not recommend Codex models missing from the live catalog", () => {
		const available = resolveAvailableCodexModelCandidates([
			{
				id: "openai",
				models: {
					"gpt-5.3-codex": {},
					"gpt-5.3-codex-removed": {},
				},
			},
		])

		assert.deepEqual(
			available.map((candidate) => `${candidate.providerID}/${candidate.modelID}`),
			["openai/gpt-5.3-codex"],
		)
	})

	it("recommends only accepted domestic models in the verified group", () => {
		const verified = resolveVerifiedChinaModelCandidates([
			{ id: "deepseek", models: { "deepseek-chat": {} } },
			{ id: "zhipuai", models: { "glm-4.7-flash": {} } },
			{ id: "kimi-for-coding", models: { "kimi-for-coding": {} } },
		])

		assert.deepEqual(
			verified.map((candidate) => `${candidate.providerID}/${candidate.modelID}`),
			["deepseek/deepseek-chat", "zhipuai/glm-4.7-flash"],
		)
	})
})
