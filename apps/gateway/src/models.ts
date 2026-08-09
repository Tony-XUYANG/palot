/**
 * Public Palot Cloud model aliases and their upstream routing metadata.
 */

export type PalotCloudModelId = "palot-deepseek-chat" | "palot-glm-coding"
export type UpstreamProviderId = "deepseek" | "zhipuai"

export interface PalotCloudModelDefinition {
	id: PalotCloudModelId
	label: string
	provider: UpstreamProviderId
	upstreamModel: string
	apiKeyEnvironmentVariable: string
	baseUrlEnvironmentVariable: string
	defaultBaseUrl: string
	maxReservationOutputTokens: number
}

export const PALOT_CLOUD_MODELS = [
	{
		id: "palot-deepseek-chat",
		label: "Palot DeepSeek",
		provider: "deepseek",
		upstreamModel: "deepseek-chat",
		apiKeyEnvironmentVariable: "DEEPSEEK_API_KEY",
		baseUrlEnvironmentVariable: "DEEPSEEK_BASE_URL",
		defaultBaseUrl: "https://api.deepseek.com",
		maxReservationOutputTokens: 8_192,
	},
	{
		id: "palot-glm-coding",
		label: "Palot GLM Coding",
		provider: "zhipuai",
		upstreamModel: "glm-4.7-flash",
		apiKeyEnvironmentVariable: "ZHIPUAI_API_KEY",
		baseUrlEnvironmentVariable: "ZHIPUAI_BASE_URL",
		defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
		maxReservationOutputTokens: 8_192,
	},
] as const satisfies readonly PalotCloudModelDefinition[]

const MODEL_BY_ID = new Map(PALOT_CLOUD_MODELS.map((model) => [model.id, model]))

export function resolvePalotCloudModel(value: string): PalotCloudModelDefinition | null {
	return MODEL_BY_ID.get(value as PalotCloudModelId) ?? null
}
