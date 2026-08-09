/**
 * Integer-micro pricing and conservative request reservation helpers.
 */

export const MICROS_PER_YUAN = 1_000_000n
export const TOKENS_PER_PRICE_UNIT = 1_000_000n
export const DEFAULT_MARKUP_BASIS_POINTS = 3_000
const BASIS_POINTS_DENOMINATOR = 10_000n

export interface ModelPrice {
	modelId: string
	inputMicrosPerMillion: bigint
	outputMicrosPerMillion: bigint
	cacheReadMicrosPerMillion: bigint
	version: number
}

export interface TokenUsage {
	inputTokens: number
	outputTokens: number
	cacheReadTokens: number
	source: "provider" | "estimated"
}

function costForTokens(tokens: number, rate: bigint): bigint {
	if (tokens <= 0 || rate <= 0n) return 0n
	const numerator = BigInt(tokens) * rate
	return (numerator + TOKENS_PER_PRICE_UNIT - 1n) / TOKENS_PER_PRICE_UNIT
}

export function calculateUsageCost(price: ModelPrice, usage: TokenUsage): bigint {
	const uncachedInput = Math.max(0, usage.inputTokens - usage.cacheReadTokens)
	return (
		costForTokens(uncachedInput, price.inputMicrosPerMillion) +
		costForTokens(usage.cacheReadTokens, price.cacheReadMicrosPerMillion) +
		costForTokens(usage.outputTokens, price.outputMicrosPerMillion)
	)
}

export function estimateTextTokens(value: string): number {
	let asciiCharacters = 0
	let nonAsciiCharacters = 0
	for (const character of value) {
		if (character.codePointAt(0)! <= 0x7f) asciiCharacters++
		else nonAsciiCharacters++
	}
	return Math.max(1, Math.ceil(asciiCharacters / 4) + nonAsciiCharacters)
}

export function estimateRequestInputTokens(body: unknown): number {
	return estimateTextTokens(JSON.stringify(body))
}

export function resolveRequestedOutputTokens(
	body: Record<string, unknown>,
	modelMaximum: number,
): number {
	const candidate = body.max_completion_tokens ?? body.max_tokens
	if (typeof candidate !== "number" || !Number.isInteger(candidate) || candidate < 1) {
		return modelMaximum
	}
	return Math.min(candidate, modelMaximum)
}

export function calculateReservation(
	price: ModelPrice,
	inputTokens: number,
	maximumOutputTokens: number,
): bigint {
	return calculateUsageCost(price, {
		inputTokens,
		outputTokens: maximumOutputTokens,
		cacheReadTokens: 0,
		source: "estimated",
	})
}

export function applyMarkup(amountMicros: bigint, markupBasisPoints: number): bigint {
	if (
		!Number.isInteger(markupBasisPoints) ||
		markupBasisPoints < 0 ||
		markupBasisPoints > 100_000
	) {
		throw new Error("Markup basis points must be an integer between 0 and 100000")
	}
	const multiplier = BASIS_POINTS_DENOMINATOR + BigInt(markupBasisPoints)
	return (amountMicros * multiplier + BASIS_POINTS_DENOMINATOR - 1n) / BASIS_POINTS_DENOMINATOR
}

export function parseYuanToMicros(value: string): bigint {
	const match = value.trim().match(/^(\d+)(?:\.(\d{1,6}))?$/)
	if (!match) throw new Error("Amount must be a positive decimal with at most 6 places")
	const fraction = (match[2] ?? "").padEnd(6, "0")
	const amount = BigInt(match[1]) * MICROS_PER_YUAN + BigInt(fraction || "0")
	if (amount <= 0n) throw new Error("Amount must be greater than zero")
	return amount
}

export function formatMicrosAsYuan(micros: bigint): string {
	const negative = micros < 0n
	const absolute = negative ? -micros : micros
	const yuan = absolute / MICROS_PER_YUAN
	const fraction = (absolute % MICROS_PER_YUAN).toString().padStart(6, "0").replace(/0+$/, "")
	return `${negative ? "-" : ""}${yuan}${fraction ? `.${fraction}` : ""}`
}
