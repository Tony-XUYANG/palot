import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
	applyMarkup,
	calculateReservation,
	calculateUsageCost,
	estimateTextTokens,
	formatMicrosAsYuan,
	type ModelPrice,
	parseYuanToMicros,
	resolveRequestedOutputTokens,
} from "./pricing"

const price: ModelPrice = {
	modelId: "palot-test",
	version: 1,
	inputMicrosPerMillion: 1_000_000n,
	outputMicrosPerMillion: 2_000_000n,
	cacheReadMicrosPerMillion: 100_000n,
}

describe("Palot Cloud pricing", () => {
	it("uses integer micro-yuan and separates cached input", () => {
		assert.equal(
			calculateUsageCost(price, {
				inputTokens: 1_000,
				outputTokens: 500,
				cacheReadTokens: 200,
				source: "provider",
			}),
			1_820n,
		)
		assert.equal(calculateReservation(price, 1_000, 500), 2_000n)
	})

	it("parses money without floating point and formats exact values", () => {
		assert.equal(parseYuanToMicros("30"), 30_000_000n)
		assert.equal(parseYuanToMicros("0.000001"), 1n)
		assert.equal(formatMicrosAsYuan(30_250_000n), "30.25")
		assert.throws(() => parseYuanToMicros("1.0000001"), /at most 6 places/)
	})

	it("applies the configured retail markup with upward micro rounding", () => {
		assert.equal(applyMarkup(1_000_000n, 3_000), 1_300_000n)
		assert.equal(applyMarkup(1n, 3_000), 2n)
		assert.throws(() => applyMarkup(1n, -1), /basis points/)
	})

	it("bounds reservations and estimates non-ASCII text conservatively", () => {
		assert.equal(resolveRequestedOutputTokens({ max_tokens: 50_000 }, 8_192), 8_192)
		assert.equal(resolveRequestedOutputTokens({}, 8_192), 8_192)
		assert.ok(estimateTextTokens("修改这个函数") >= 6)
	})
})
