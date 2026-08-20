/**
 * OpenCode configuration for Tencent Cloud Token Plan.
 * The long-lived API key stays in auth.json and is never written to this config.
 */

import type { Config, ProviderConfig } from "@opencode-ai/sdk/v2/client";

export const TENCENT_TOKEN_PLAN_PROVIDER_ID = "tencent-token-plan";
export const TENCENT_TOKEN_PLAN_API_URL =
	"https://api.lkeap.cloud.tencent.com/plan/v3";
export const TENCENT_TOKEN_PLAN_DOCS_URL =
	"https://cloud.tencent.com/document/product/1823/130060";

export function createTencentTokenPlanProviderConfig(): ProviderConfig {
	return {
		id: TENCENT_TOKEN_PLAN_PROVIDER_ID,
		name: "Tencent Token Plan",
		api: TENCENT_TOKEN_PLAN_API_URL,
		npm: "@ai-sdk/openai-compatible",
		env: ["TENCENT_TOKEN_PLAN_API_KEY"],
		models: {
			hy3: {
				id: "hy3",
				name: "Hy3",
				reasoning: true,
				tool_call: true,
				temperature: true,
				limit: { context: 256_000, output: 64_000 },
				modalities: { input: ["text"], output: ["text"] },
			},
		},
		options: { baseURL: TENCENT_TOKEN_PLAN_API_URL },
	};
}

export function updateTencentTokenPlanProviderLists(
	config: Config,
	enabled: boolean,
) {
	const disabled = new Set(config.disabled_providers ?? []);
	if (enabled) disabled.delete(TENCENT_TOKEN_PLAN_PROVIDER_ID);
	else disabled.add(TENCENT_TOKEN_PLAN_PROVIDER_ID);

	const enabledProviders = config.enabled_providers
		? new Set(config.enabled_providers)
		: null;
	if (enabled) enabledProviders?.add(TENCENT_TOKEN_PLAN_PROVIDER_ID);
	else enabledProviders?.delete(TENCENT_TOKEN_PLAN_PROVIDER_ID);

	return {
		disabled_providers: [...disabled],
		...(enabledProviders ? { enabled_providers: [...enabledProviders] } : {}),
	};
}
