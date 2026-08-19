/**
 * Provider constants and metadata shared across onboarding, settings, and dialogs.
 */

// ============================================================
// Provider ordering
// ============================================================

/** Chinese providers shown first for the Windows China-focused experience. */
export const CHINA_PROVIDER_IDS = [
	"deepseek",
	"zhipuai",
	"kimi-for-coding",
	"alibaba-cn",
	"moonshotai-cn",
	"siliconflow-cn",
	"minimax-cn",
	"modelscope",
	"alibaba-coding-plan-cn",
	"tencent-coding-plan",
	"stepfun-step-plan",
	"longcat",
] as const;

/** Providers that passed Palot's real code-edit and automated-test acceptance run. */
export const VERIFIED_CHINA_PROVIDER_IDS = ["deepseek", "zhipuai"] as const;

/** Backwards-compatible name for the domestic providers promoted in the first release. */
export const FIRST_TIER_CHINA_PROVIDER_IDS = VERIFIED_CHINA_PROVIDER_IDS;

/** OpenAI is featured separately because it exposes Codex models and ChatGPT OAuth. */
export const CODEX_PROVIDER_IDS = ["openai"] as const;

/** Globally popular providers shown in the alternate onboarding segment. */
export const GLOBAL_PROVIDER_IDS = [
	"anthropic",
	"google",
	"github-copilot",
	"groq",
	"openrouter",
	"xai",
] as const;

/** Codex model IDs known to the bundled OpenCode catalog. */
export const CODEX_RECOMMENDED_MODELS = [
	{ providerID: "openai", modelID: "gpt-5.3-codex" },
	{ providerID: "openai", modelID: "gpt-5.3-codex-spark" },
] as const;

export interface ModelCandidateReference {
	readonly providerID: string;
	readonly modelID: string;
}

export interface ChinaModelCandidate extends ModelCandidateReference {
	readonly tier: "verified" | "candidate";
	readonly firstTier: boolean;
}

/**
 * Coding-focused domestic models with explicit acceptance status. Availability is still
 * resolved against the live OpenCode catalog so removed models are never recommended.
 */
export const CHINA_MODEL_REGISTRY = [
	{
		providerID: "deepseek",
		modelID: "deepseek-chat",
		tier: "verified",
		firstTier: true,
	},
	{
		providerID: "zhipuai",
		modelID: "glm-4.7-flash",
		tier: "verified",
		firstTier: true,
	},
	{
		providerID: "kimi-for-coding",
		modelID: "kimi-for-coding",
		tier: "candidate",
		firstTier: false,
	},
	{
		providerID: "alibaba-cn",
		modelID: "qwen-flash",
		tier: "candidate",
		firstTier: false,
	},
	{
		providerID: "moonshotai-cn",
		modelID: "kimi-k2.5",
		tier: "candidate",
		firstTier: false,
	},
	{
		providerID: "siliconflow-cn",
		modelID: "Qwen/Qwen3-Coder-30B-A3B-Instruct",
		tier: "candidate",
		firstTier: false,
	},
	{
		providerID: "minimax-cn",
		modelID: "MiniMax-M2.5",
		tier: "candidate",
		firstTier: false,
	},
	{
		providerID: "modelscope",
		modelID: "Qwen/Qwen3-Coder-30B-A3B-Instruct",
		tier: "candidate",
		firstTier: false,
	},
	{
		providerID: "alibaba-coding-plan-cn",
		modelID: "qwen3-coder-next",
		tier: "candidate",
		firstTier: false,
	},
	{
		providerID: "tencent-coding-plan",
		modelID: "tc-code-latest",
		tier: "candidate",
		firstTier: false,
	},
	{
		providerID: "stepfun-step-plan",
		modelID: "step-3.7-flash",
		tier: "candidate",
		firstTier: false,
	},
	{
		providerID: "longcat",
		modelID: "LongCat-2.0",
		tier: "candidate",
		firstTier: false,
	},
] as const satisfies readonly ChinaModelCandidate[];

/** Backwards-compatible name used by current model-selection surfaces. */
export const CHINA_RECOMMENDED_MODELS = CHINA_MODEL_REGISTRY;

/** Minimal structural subset of CatalogProvider needed to resolve live model availability. */
export interface ProviderModelCatalogEntry {
	readonly id: string;
	readonly models: Record<string, unknown>;
}

/**
 * Keep only candidate IDs present in the live OpenCode provider catalog.
 * Candidate order and metadata are preserved.
 */
export function resolveCatalogModelCandidates<
	T extends ModelCandidateReference,
>(
	candidates: readonly T[],
	providers: readonly ProviderModelCatalogEntry[],
): T[] {
	const modelsByProvider = new Map(
		providers.map((provider) => [provider.id, provider.models]),
	);
	return candidates.filter((candidate) => {
		const models = modelsByProvider.get(candidate.providerID);
		return models !== undefined && Object.hasOwn(models, candidate.modelID);
	});
}

/** Resolve domestic candidates that still exist in the current OpenCode catalog. */
export function resolveAvailableChinaModelCandidates(
	providers: readonly ProviderModelCatalogEntry[],
): ChinaModelCandidate[] {
	return resolveCatalogModelCandidates(CHINA_MODEL_REGISTRY, providers);
}

/** Resolve Codex recommendations that still exist in the current OpenCode catalog. */
export function resolveAvailableCodexModelCandidates(
	providers: readonly ProviderModelCatalogEntry[],
): ModelCandidateReference[] {
	return resolveCatalogModelCandidates(CODEX_RECOMMENDED_MODELS, providers);
}

/** Resolve only models promoted by a completed real-world acceptance run. */
export function resolveVerifiedChinaModelCandidates(
	providers: readonly ProviderModelCatalogEntry[],
): ChinaModelCandidate[] {
	return resolveAvailableChinaModelCandidates(providers).filter(
		(candidate) => candidate.tier === "verified",
	);
}

/** Popular providers shown prominently in onboarding and settings, in display order */
export const POPULAR_PROVIDER_IDS = [
	"opencode",
	...CHINA_PROVIDER_IDS,
	...CODEX_PROVIDER_IDS,
	...GLOBAL_PROVIDER_IDS,
] as const;

const CHINA_PROVIDER_ID_SET = new Set<string>(CHINA_PROVIDER_IDS);
const CODEX_PROVIDER_ID_SET = new Set<string>(CODEX_PROVIDER_IDS);
const VERIFIED_CHINA_PROVIDER_ID_SET = new Set<string>(
	VERIFIED_CHINA_PROVIDER_IDS,
);

export function isChinaProvider(providerId: string): boolean {
	return CHINA_PROVIDER_ID_SET.has(providerId);
}

export function isCodexProvider(providerId: string): boolean {
	return CODEX_PROVIDER_ID_SET.has(providerId);
}

export function isVerifiedChinaProvider(providerId: string): boolean {
	return VERIFIED_CHINA_PROVIDER_ID_SET.has(providerId);
}

// ============================================================
// OpenCode Zen
// ============================================================

/** The provider ID for OpenCode Zen (always auto-loads, free tier available) */
export const ZEN_PROVIDER_ID = "opencode";

/** URL to sign up for an OpenCode Zen API key */
export const ZEN_SIGNUP_URL = "https://opencode.ai/zen/";

/** URL to OpenCode Zen documentation */
export const ZEN_DOCS_URL = "https://opencode.ai/docs/zen";

// ============================================================
// Provider key signup URLs
// ============================================================

/** External URLs for getting API keys from popular providers */
export const PROVIDER_KEY_URLS: Record<string, { label: string; url: string }> =
	{
		opencode: { label: "Get API key", url: "https://opencode.ai/zen/" },
		anthropic: {
			label: "Get API key",
			url: "https://console.anthropic.com/settings/keys",
		},
		openai: {
			label: "Get API key",
			url: "https://platform.openai.com/api-keys",
		},
		google: { label: "Get API key", url: "https://aistudio.google.com/apikey" },
		groq: { label: "Get API key", url: "https://console.groq.com/keys" },
		openrouter: { label: "Get API key", url: "https://openrouter.ai/keys" },
		xai: { label: "Get API key", url: "https://console.x.ai/" },
		mistral: {
			label: "Get API key",
			url: "https://console.mistral.ai/api-keys/",
		},
		deepseek: {
			label: "Get API key",
			url: "https://platform.deepseek.com/api_keys",
		},
		"alibaba-cn": {
			label: "Get API key",
			url: "https://bailian.console.aliyun.com/?apiKey=1",
		},
		"alibaba-coding-plan-cn": {
			label: "Get API key",
			url: "https://bailian.console.aliyun.com/?apiKey=1",
		},
		alibaba: {
			label: "Get API key",
			url: "https://bailian.console.aliyun.com/?apiKey=1",
		},
		"kimi-for-coding": {
			label: "Get API key",
			url: "https://www.kimi.com/code/console",
		},
		"moonshotai-cn": {
			label: "Get API key",
			url: "https://platform.moonshot.cn/console/api-keys",
		},
		moonshotai: {
			label: "Get API key",
			url: "https://platform.moonshot.ai/console/api-keys",
		},
		zhipuai: {
			label: "Get API key",
			url: "https://open.bigmodel.cn/usercenter/apikeys",
		},
		"zhipuai-coding-plan": {
			label: "Get API key",
			url: "https://open.bigmodel.cn/usercenter/apikeys",
		},
		"siliconflow-cn": {
			label: "Get API key",
			url: "https://cloud.siliconflow.cn/account/ak",
		},
		siliconflow: {
			label: "Get API key",
			url: "https://cloud.siliconflow.com/account/ak",
		},
		"minimax-cn": {
			label: "Get API key",
			url: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
		},
		"minimax-cn-coding-plan": {
			label: "Get API key",
			url: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
		},
		modelscope: {
			label: "Get API key",
			url: "https://modelscope.cn/my/myaccesstoken",
		},
		"tencent-coding-plan": {
			label: "Get API key",
			url: "https://console.cloud.tencent.com/lkeap",
		},
		"stepfun-step-plan": {
			label: "Get API key",
			url: "https://platform.stepfun.com/",
		},
		longcat: { label: "Get API key", url: "https://longcat.chat/" },
		cohere: {
			label: "Get API key",
			url: "https://dashboard.cohere.com/api-keys",
		},
		fireworks: {
			label: "Get API key",
			url: "https://fireworks.ai/account/api-keys",
		},
		perplexity: {
			label: "Get API key",
			url: "https://www.perplexity.ai/settings/api",
		},
	};

// ============================================================
// Sorting helpers
// ============================================================

/** Sort comparator: popular providers first (by POPULAR_PROVIDER_IDS order), then alphabetical */
export function compareByPopularity(
	a: { id: string; name: string },
	b: { id: string; name: string },
): number {
	const aIdx = POPULAR_PROVIDER_IDS.indexOf(
		a.id as (typeof POPULAR_PROVIDER_IDS)[number],
	);
	const bIdx = POPULAR_PROVIDER_IDS.indexOf(
		b.id as (typeof POPULAR_PROVIDER_IDS)[number],
	);
	if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
	if (aIdx !== -1) return -1;
	if (bIdx !== -1) return 1;
	return a.name.localeCompare(b.name);
}

/** Sort comparator: connected first, then by popularity */
export function compareConnectedFirst(
	connectedIds: Set<string>,
	a: { id: string; name: string },
	b: { id: string; name: string },
): number {
	const aConnected = connectedIds.has(a.id);
	const bConnected = connectedIds.has(b.id);
	if (aConnected && !bConnected) return -1;
	if (!aConnected && bConnected) return 1;
	return compareByPopularity(a, b);
}

// ============================================================
// Zen tier detection
// ============================================================

/**
 * Threshold for distinguishing Zen free tier from paid.
 * The server strips paid models when there is no API key, leaving only ~6 free models.
 * With an API key, 20+ models are available.
 */
const ZEN_FREE_TIER_MAX_MODELS = 10;

/**
 * Heuristic: determine whether the Zen provider is on the free tier
 * by checking how many models the server returned. The server strips
 * paid models for users without an API key, so a low model count
 * means free tier.
 */
export function isZenFreeTier(models: Record<string, unknown>): boolean {
	return Object.keys(models).length <= ZEN_FREE_TIER_MAX_MODELS;
}

// ============================================================
// Subscription detection
// ============================================================

interface ModelWithCost {
	cost?: { input?: number };
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
export function isSubscriptionConnected(
	models: Record<string, unknown>,
): boolean {
	const entries = Object.values(models) as ModelWithCost[];
	if (entries.length === 0) return false;
	return entries.every((m) => m.cost?.input === 0);
}

/** Display labels for subscription-connected providers */
export const SUBSCRIPTION_LABELS: Record<string, string> = {
	anthropic: "Claude Pro/Max",
	openai: "ChatGPT Pro/Plus",
};
