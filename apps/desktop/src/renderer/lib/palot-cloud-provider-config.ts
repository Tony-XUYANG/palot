/**
 * Pure OpenCode provider configuration for the process-local Palot Cloud proxy.
 */

import type { Config, ProviderConfig } from "@opencode-ai/sdk/v2/client"
import type { PalotCloudProviderSetup } from "../../preload/api"

export const PALOT_CLOUD_PROVIDER_ID = "palot-cloud"

export function createPalotCloudProviderConfig(
	setup: PalotCloudProviderSetup,
): ProviderConfig {
	return {
		id: PALOT_CLOUD_PROVIDER_ID,
		name: "Palot Cloud",
		npm: "@ai-sdk/openai-compatible",
		models: Object.fromEntries(
			setup.models.map((model) => [
				model.id,
				{
					id: model.id,
					name: model.name,
					tool_call: true,
					temperature: true,
					limit: { context: 65_536, output: 8_192 },
					modalities: { input: ["text", "image"], output: ["text"] },
				},
			]),
		),
		options: {
			baseURL: setup.baseUrl,
			apiKey: setup.sessionToken,
		},
	}
}

export function updatePalotCloudProviderLists(config: Config, enabled: boolean) {
	const disabled = new Set(config.disabled_providers ?? [])
	if (enabled) disabled.delete(PALOT_CLOUD_PROVIDER_ID)
	else disabled.add(PALOT_CLOUD_PROVIDER_ID)

	const enabledProviders = config.enabled_providers
		? new Set(config.enabled_providers)
		: null
	if (enabled) enabledProviders?.add(PALOT_CLOUD_PROVIDER_ID)
	else enabledProviders?.delete(PALOT_CLOUD_PROVIDER_ID)

	return {
		disabled_providers: [...disabled],
		...(enabledProviders ? { enabled_providers: [...enabledProviders] } : {}),
	}
}
