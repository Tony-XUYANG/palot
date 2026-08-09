import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { PALOT_CLOUD_MODELS } from "./models"

describe("Palot Cloud upstream routes", () => {
	it("pins the provider models accepted by the live official APIs", () => {
		assert.deepEqual(
			PALOT_CLOUD_MODELS.map((model) => [model.id, model.upstreamModel]),
			[
				["palot-deepseek-chat", "deepseek-v4-flash"],
				["palot-glm-coding", "glm-4.7-flashx"],
			],
		)
	})
})
