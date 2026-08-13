const { describe, expect, it } = require("bun:test")
const {
	parseArguments,
	retryTransientUpdaterOperation,
} = require("./run-electron-updater-driver.cjs")

describe("Electron updater acceptance driver", () => {
	it("parses the loopback port and expected version", () => {
		expect(parseArguments(["--port", "49200", "--version", "1.2.3"])).toEqual({
			port: 49200,
			expectedVersion: "1.2.3",
			downloadTimeoutMs: 900000,
		})
	})

	it("retries transient network failures", async () => {
		let calls = 0
		const result = await retryTransientUpdaterOperation(
			async () => {
				calls++
				if (calls < 3) throw new Error("net::ERR_CONNECTION_CLOSED")
				return "ready"
			},
			3,
			1,
		)
		expect(result).toBe("ready")
		expect(calls).toBe(3)
	})

	it("does not retry permanent updater failures", async () => {
		let calls = 0
		await expect(
			retryTransientUpdaterOperation(async () => {
				calls++
				throw new Error("Update manifest SHA mismatch")
			}),
		).rejects.toThrow("SHA mismatch")
		expect(calls).toBe(1)
	})
})
