const { describe, expect, it } = require("bun:test")
const {
	assertUpdateSourceResult,
	parseArguments,
} = require("./run-electron-updater-source-driver.cjs")

describe("Electron updater source driver", () => {
	it("parses the expected version and defaults to the China source", () => {
		expect(parseArguments(["--port", "49200", "--version", "0.12.0-beta.6"])).toEqual({
			port: 49200,
			expectedVersion: "0.12.0-beta.6",
			expectedSource: "china",
		})
	})

	it("accepts an idle China-source check without fallback", () => {
		const result = {
			appInfo: { version: "0.12.0-beta.6", isDev: false },
			state: { status: "idle", source: "china", fallbackUsed: false },
		}
		expect(
			assertUpdateSourceResult(result, {
				expectedVersion: "0.12.0-beta.6",
				expectedSource: "china",
			}),
		).toBe(result)
	})

	it("rejects GitHub fallback and non-idle results", () => {
		const expected = {
			expectedVersion: "0.12.0-beta.6",
			expectedSource: "china",
		}
		expect(() =>
			assertUpdateSourceResult(
				{
					appInfo: { version: expected.expectedVersion },
					state: { status: "idle", source: "github", fallbackUsed: true },
				},
				expected,
			),
		).toThrow("Expected update source china")
		expect(() =>
			assertUpdateSourceResult(
				{
					appInfo: { version: expected.expectedVersion },
					state: { status: "available", source: "china", fallbackUsed: false },
				},
				expected,
			),
		).toThrow("remain idle")
	})
})
