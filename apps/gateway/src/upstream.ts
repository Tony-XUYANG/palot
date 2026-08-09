/**
 * OpenAI-compatible upstream request preparation and usage extraction.
 */

import type { PalotCloudModelDefinition } from "./models"
import { estimateTextTokens, type TokenUsage } from "./pricing"

interface OpenAiUsageShape {
	prompt_tokens?: unknown
	completion_tokens?: unknown
	prompt_tokens_details?: {
		cached_tokens?: unknown
	}
}

function nonNegativeInteger(value: unknown): number | null {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null
}

export function parseProviderUsage(value: unknown): TokenUsage | null {
	if (!value || typeof value !== "object") return null
	const body = value as { usage?: OpenAiUsageShape }
	if (!body.usage) return null
	const inputTokens = nonNegativeInteger(body.usage.prompt_tokens)
	const outputTokens = nonNegativeInteger(body.usage.completion_tokens)
	if (inputTokens === null || outputTokens === null) return null
	return {
		inputTokens,
		outputTokens,
		cacheReadTokens: nonNegativeInteger(body.usage.prompt_tokens_details?.cached_tokens) ?? 0,
		source: "provider",
	}
}

function collectStrings(value: unknown, output: string[]): void {
	if (typeof value === "string") {
		output.push(value)
		return
	}
	if (Array.isArray(value)) {
		for (const item of value) collectStrings(item, output)
		return
	}
	if (!value || typeof value !== "object") return
	for (const [key, child] of Object.entries(value)) {
		if (key === "usage" || key === "model" || key === "id") continue
		collectStrings(child, output)
	}
}

export function estimateResponseOutputTokens(value: unknown): number {
	const strings: string[] = []
	if (value && typeof value === "object" && "choices" in value) {
		collectStrings((value as { choices: unknown }).choices, strings)
	} else {
		collectStrings(value, strings)
	}
	return estimateTextTokens(strings.join(""))
}

export function createUpstreamRequestBody(
	body: Record<string, unknown>,
	model: PalotCloudModelDefinition,
): Record<string, unknown> {
	const stream = body.stream === true
	return {
		...body,
		model: model.upstreamModel,
		...(stream
			? {
					stream_options: {
						...(body.stream_options && typeof body.stream_options === "object"
							? body.stream_options
							: {}),
						include_usage: true,
					},
				}
			: {}),
	}
}

export function createUpstreamUrl(baseUrl: string): string {
	return `${baseUrl.replace(/\/$/, "")}/chat/completions`
}

export class StreamingUsageCollector {
	private readonly decoder = new TextDecoder()
	private lineBuffer = ""
	private readonly outputParts: string[] = []
	private providerUsage: TokenUsage | null = null

	push(chunk: Uint8Array): void {
		this.lineBuffer += this.decoder.decode(chunk, { stream: true })
		this.drainLines()
	}

	finish(): void {
		this.lineBuffer += this.decoder.decode()
		this.drainLines(true)
	}

	usage(inputTokens: number): TokenUsage {
		return (
			this.providerUsage ?? {
				inputTokens,
				outputTokens: estimateTextTokens(this.outputParts.join("")),
				cacheReadTokens: 0,
				source: "estimated",
			}
		)
	}

	private drainLines(flush = false): void {
		for (;;) {
			const newline = this.lineBuffer.indexOf("\n")
			if (newline < 0) break
			const line = this.lineBuffer.slice(0, newline).replace(/\r$/, "")
			this.lineBuffer = this.lineBuffer.slice(newline + 1)
			this.consumeLine(line)
		}
		if (flush && this.lineBuffer) {
			this.consumeLine(this.lineBuffer.replace(/\r$/, ""))
			this.lineBuffer = ""
		}
	}

	private consumeLine(line: string): void {
		if (!line.startsWith("data:")) return
		const data = line.slice(5).trim()
		if (!data || data === "[DONE]") return
		try {
			const value = JSON.parse(data) as unknown
			this.providerUsage = parseProviderUsage(value) ?? this.providerUsage
			if (value && typeof value === "object" && "choices" in value) {
				collectStrings((value as { choices: unknown }).choices, this.outputParts)
			}
		} catch {
			// A malformed vendor chunk remains transparent to the client and is not logged.
		}
	}
}
