import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	createTencentTokenPlanProviderConfig,
	TENCENT_TOKEN_PLAN_API_URL,
	TENCENT_TOKEN_PLAN_PROVIDER_ID,
	updateTencentTokenPlanProviderLists,
} from "./tencent-token-plan-provider-config.ts";

describe("Tencent Token Plan OpenCode configuration", () => {
	it("uses the official compatible endpoint without persisting an API key", () => {
		const config = createTencentTokenPlanProviderConfig();
		assert.equal(config.id, TENCENT_TOKEN_PLAN_PROVIDER_ID);
		assert.equal(config.api, TENCENT_TOKEN_PLAN_API_URL);
		assert.equal(config.npm, "@ai-sdk/openai-compatible");
		assert.deepEqual(config.env, ["TENCENT_TOKEN_PLAN_API_KEY"]);
		assert.equal(config.options?.baseURL, TENCENT_TOKEN_PLAN_API_URL);
		assert.equal(config.options?.apiKey, undefined);
		assert.deepEqual(Object.keys(config.models ?? {}), ["hy3"]);
		assert.equal(config.models?.hy3?.tool_call, true);
	});

	it("preserves provider allowlists while enabling and disabling Token Plan", () => {
		const enabled = updateTencentTokenPlanProviderLists(
			{
				enabled_providers: ["deepseek"],
				disabled_providers: [TENCENT_TOKEN_PLAN_PROVIDER_ID],
			},
			true,
		);
		assert.deepEqual(enabled.enabled_providers, [
			"deepseek",
			TENCENT_TOKEN_PLAN_PROVIDER_ID,
		]);
		assert.deepEqual(enabled.disabled_providers, []);

		const disabled = updateTencentTokenPlanProviderLists(
			{ enabled_providers: enabled.enabled_providers, disabled_providers: [] },
			false,
		);
		assert.deepEqual(disabled.enabled_providers, ["deepseek"]);
		assert.deepEqual(disabled.disabled_providers, [
			TENCENT_TOKEN_PLAN_PROVIDER_ID,
		]);
	});
});
