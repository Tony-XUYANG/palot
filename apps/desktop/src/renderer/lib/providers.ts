/**
 * Provider constants and metadata shared across onboarding, settings, and dialogs.
 */

// ============================================================
// Provider ordering
// ============================================================

/** Chinese providers shown first for the Windows China-focused experience. */
export const CHINA_PROVIDER_IDS = [
	"deepseek",
	"alibaba-cn",
	"kimi-for-coding",
	"moonshotai-cn",
	"zhipuai",
	"siliconflow-cn",
	"minimax-cn",
	"modelscope",
] as const

/** OpenAI is featured separately because it exposes Codex models and ChatGPT OAuth. */
export const CODEX_PROVIDER_IDS = ["openai"] as const

/** Globally popular providers shown in the alternate onboarding segment. */
export const GLOBAL_PROVIDER_IDS = [
	"anthropic",
	"google",
	"github-copilot",
	"groq",
	"openrouter",
	"xai",
] as const

/** Codex models verified against the OpenCode 1.18.5 provider catalog. */
export const CODEX_RECOMMENDED_MODELS = [
	{ providerID: "openai", modelID: "gpt-5.3-codex" },
	{ providerID: "openai", modelID: "gpt-5.3-codex-spark" },
] as const

/** Low-cost or coding-focused models verified against the OpenCode 1.18.5 catalog. */
export const CHINA_RECOMMENDED_MODELS = [
	{ providerID: "deepseek", modelID: "deepseek-chat" },
	{ providerID: "alibaba-cn", modelID: "qwen-flash" },
	{ providerID: "kimi-for-coding", modelID: "kimi-for-coding" },
	{ providerID: "moonshotai-cn", modelID: "kimi-k2.5" },
	{ providerID: "zhipuai", modelID: "glm-4.7-flash" },
	{ providerID: "siliconflow-cn", modelID: "Qwen/Qwen3-Coder-30B-A3B-Instruct" },
	{ providerID: "minimax-cn", modelID: "MiniMax-M2.5" },
	{ providerID: "modelscope", modelID: "Qwen/Qwen3-Coder-30B-A3B-Instruct" },
] as const

/** Popular providers shown prominently in onboarding and settings, in display order */
export const POPULAR_PROVIDER_IDS = [
	"opencode",
	...CODEX_PROVIDER_IDS,
	...CHINA_PROVIDER_IDS,
	...GLOBAL_PROVIDER_IDS,
] as const

const CHINA_PROVIDER_ID_SET = new Set<string>(CHINA_PROVIDER_IDS)
const CODEX_PROVIDER_ID_SET = new Set<string>(CODEX_PROVIDER_IDS)

export function isChinaProvider(providerId: string): boolean {
	return CHINA_PROVIDER_ID_SET.has(providerId)
}

export function isCodexProvider(providerId: string): boolean {
	return CODEX_PROVIDER_ID_SET.has(providerId)
}

// ============================================================
// OpenCode Zen
// ============================================================

/** The provider ID for OpenCode Zen (always auto-loads, free tier available) */
export const ZEN_PROVIDER_ID = "opencode"

/** URL to sign up for an OpenCode Zen API key */
export const ZEN_SIGNUP_URL = "https://opencode.ai/zen/"

/** URL to OpenCode Zen documentation */
export const ZEN_DOCS_URL = "https://opencode.ai/docs/zen"

// ============================================================
// Provider key signup URLs
// ============================================================

/** External URLs for getting API keys from popular providers */
export const PROVIDER_KEY_URLS: Record<string, { label: string; url: string }> = {
	opencode: { label: "Get API key", url: "https://opencode.ai/zen/" },
	anthropic: { label: "Get API key", url: "https://console.anthropic.com/settings/keys" },
	openai: { label: "Get API key", url: "https://platform.openai.com/api-keys" },
	google: { label: "Get API key", url: "https://aistudio.google.com/apikey" },
	groq: { label: "Get API key", url: "https://console.groq.com/keys" },
	openrouter: { label: "Get API key", url: "https://openrouter.ai/keys" },
	xai: { label: "Get API key", url: "https://console.x.ai/" },
	mistral: { label: "Get API key", url: "https://console.mistral.ai/api-keys/" },
	deepseek: { label: "Get API key", url: "https://platform.deepseek.com/api_keys" },
	"alibaba-cn": { label: "Get API key", url: "https://bailian.console.aliyun.com/?apiKey=1" },
	alibaba: { label: "Get API key", url: "https://bailian.console.aliyun.com/?apiKey=1" },
	"kimi-for-coding": { label: "Get API key", url: "https://www.kimi.com/code" },
	"moonshotai-cn": {
		label: "Get API key",
		url: "https://platform.moonshot.cn/console/api-keys",
	},
	moonshotai: { label: "Get API key", url: "https://platform.moonshot.ai/console/api-keys" },
	zhipuai: { label: "Get API key", url: "https://open.bigmodel.cn/usercenter/apikeys" },
	"zhipuai-coding-plan": {
		label: "Get API key",
		url: "https://open.bigmodel.cn/usercenter/apikeys",
	},
	"siliconflow-cn": { label: "Get API key", url: "https://cloud.siliconflow.cn/account/ak" },
	siliconflow: { label: "Get API key", url: "https://cloud.siliconflow.com/account/ak" },
	"minimax-cn": {
		label: "Get API key",
		url: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
	},
	"minimax-cn-coding-plan": {
		label: "Get API key",
		url: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
	},
	modelscope: { label: "Get API key", url: "https://modelscope.cn/my/myaccesstoken" },
	cohere: { label: "Get API key", url: "https://dashboard.cohere.com/api-keys" },
	fireworks: { label: "Get API key", url: "https://fireworks.ai/account/api-keys" },
	perplexity: { label: "Get API key", url: "https://www.perplexity.ai/settings/api" },
}

// ============================================================
// Sorting helpers
// ============================================================

/** Sort comparator: popular providers first (by POPULAR_PROVIDER_IDS order), then alphabetical */
export function compareByPopularity(
	a: { id: string; name: string },
	b: { id: string; name: string },
): number {
	const aIdx = POPULAR_PROVIDER_IDS.indexOf(a.id as (typeof POPULAR_PROVIDER_IDS)[number])
	const bIdx = POPULAR_PROVIDER_IDS.indexOf(b.id as (typeof POPULAR_PROVIDER_IDS)[number])
	if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx
	if (aIdx !== -1) return -1
	if (bIdx !== -1) return 1
	return a.name.localeCompare(b.name)
}

/** Sort comparator: connected first, then by popularity */
export function compareConnectedFirst(
	connectedIds: Set<string>,
	a: { id: string; name: string },
	b: { id: string; name: string },
): number {
	const aConnected = connectedIds.has(a.id)
	const bConnected = connectedIds.has(b.id)
	if (aConnected && !bConnected) return -1
	if (!aConnected && bConnected) return 1
	return compareByPopularity(a, b)
}

// ============================================================
// Zen tier detection
// ============================================================

/**
 * Threshold for distinguishing Zen free tier from paid.
 * The server strips paid models when there is no API key, leaving only ~6 free models.
 * With an API key, 20+ models are available.
 */
const ZEN_FREE_TIER_MAX_MODELS = 10

/**
 * Heuristic: determine whether the Zen provider is on the free tier
 * by checking how many models the server returned. The server strips
 * paid models for users without an API key, so a low model count
 * means free tier.
 */
export function isZenFreeTier(models: Record<string, unknown>): boolean {
	return Object.keys(models).length <= ZEN_FREE_TIER_MAX_MODELS
}

// ============================================================
// Subscription detection
// ============================================================

interface ModelWithCost {
	cost?: { input?: number }
}

/**
 * Heuristic: detect whether a provider is connected via a subscription plan
 * (e.g. Claude Pro/Max) by checking if ALL model costs are zeroed out.
 *
 * The OpenCode auth plugins zero out costs for subscription-based OAuth
 * connections (Anthropic Pro/Max, OpenAI ChatGPT Pro/Plus). The `source`
 * field from the server is unreliable for this distinction, so we use
 * model costs instead.
 */
export function isSubscriptionConnected(models: Record<string, unknown>): boolean {
	const entries = Object.values(models) as ModelWithCost[]
	if (entries.length === 0) return false
	return entries.every((m) => m.cost?.input === 0)
}

/** Display labels for subscription-connected providers */
export const SUBSCRIPTION_LABELS: Record<string, string> = {
	anthropic: "Claude Pro/Max",
	openai: "ChatGPT Pro/Plus",
}
