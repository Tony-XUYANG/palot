import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PalotCloudProviderSetup } from "../../preload/api";
import {
	createPalotCloudProviderConfig,
	PALOT_CLOUD_PROVIDER_ID,
	updatePalotCloudProviderLists,
} from "./palot-cloud-provider-config.ts";

const setup: PalotCloudProviderSetup = {
	providerId: "palot-cloud",
	baseUrl: "http://127.0.0.1:43001/v1",
	sessionToken: "process-local-token",
	models: [
		{
			id: "palot-deepseek-chat",
			name: "Palot DeepSeek",
			pricing: {
				currency: "CNY",
				unit: "million_tokens",
				inputMicros: "1300000",
				outputMicros: "2600000",
				cacheReadMicros: "130000",
				version: 1,
			},
		},
	],
};

describe("Palot Cloud OpenCode configuration", () => {
	it("uses only the loopback URL and process-local token", () => {
		const config = createPalotCloudProviderConfig(setup);
		assert.equal(config.npm, "@ai-sdk/openai-compatible");
		assert.equal(config.options?.baseURL, setup.baseUrl);
		assert.equal(config.options?.apiKey, setup.sessionToken);
		assert.deepEqual(Object.keys(config.models ?? {}), ["palot-deepseek-chat"]);
	});

	it("preserves existing provider allowlists while enabling and disabling Palot Cloud", () => {
		const enabled = updatePalotCloudProviderLists(
			{
				enabled_providers: ["deepseek"],
				disabled_providers: [PALOT_CLOUD_PROVIDER_ID],
			},
			true,
		);
		assert.deepEqual(enabled.enabled_providers, [
			"deepseek",
			PALOT_CLOUD_PROVIDER_ID,
		]);
		assert.deepEqual(enabled.disabled_providers, []);

		const disabled = updatePalotCloudProviderLists(
			{ enabled_providers: enabled.enabled_providers, disabled_providers: [] },
			false,
		);
		assert.deepEqual(disabled.enabled_providers, ["deepseek"]);
		assert.deepEqual(disabled.disabled_providers, [PALOT_CLOUD_PROVIDER_ID]);
	});
});
