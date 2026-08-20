import { describe, expect, it } from "bun:test"
import {
	createUpdateSources,
	getReleasePageUrl,
	parseChinaUpdateConfiguration,
	runWithUpdateSourceFallback,
} from "./update-sources"

const validConfiguration = {
	updateBaseUrl: "https://downloads.example.cn/palot/windows/",
	downloadPageUrl: "https://palot.example.cn/download?platform=windows",
}

describe("China update configuration", () => {
	it("requires both URLs and normalizes the update base URL", () => {
		expect(parseChinaUpdateConfiguration(validConfiguration)).toEqual({
			updateBaseUrl: "https://downloads.example.cn/palot/windows",
			downloadPageUrl: "https://palot.example.cn/download?platform=windows",
		})
		expect(
			parseChinaUpdateConfiguration({ updateBaseUrl: "", downloadPageUrl: "" }),
		).toBeNull()
		expect(() =>
			parseChinaUpdateConfiguration({
				updateBaseUrl: validConfiguration.updateBaseUrl,
			}),
		).toThrow("configured together")
	})

	it.each([
		"http://downloads.example.cn/palot/windows",
		"https://user:secret@downloads.example.cn/palot/windows",
		"https://downloads.example.cn/palot/windows#latest",
		"https://downloads.example.cn/palot/windows?channel=latest",
		"https://localhost/palot/windows",
		"https://localhost./palot/windows",
		"https://127.0.0.1/palot/windows",
		"https://[::1]/palot/windows",
	])("rejects unsafe update URL %s", (updateBaseUrl) => {
		expect(() =>
			parseChinaUpdateConfiguration({
				updateBaseUrl,
				downloadPageUrl: validConfiguration.downloadPageUrl,
			}),
		).toThrow()
	})
})

describe("update source order", () => {
	it("uses the China mirror first on Windows and GitHub as fallback", () => {
		const sources = createUpdateSources("win32", validConfiguration)
		expect(sources.map((source) => source.id)).toEqual(["china", "github"])
		expect(sources[0]?.feed).toMatchObject({
			provider: "generic",
			channel: "latest",
			useMultipleRangeRequest: false,
		})
	})

	it("keeps non-Windows platforms and unconfigured builds on GitHub", () => {
		expect(createUpdateSources("darwin", validConfiguration).map((source) => source.id)).toEqual([
			"github",
		])
		expect(
			createUpdateSources("win32", {}).map((source) => source.id),
		).toEqual(["github"])
	})

	it("builds a version-specific GitHub page and keeps the China download page", () => {
		const [china, github] = createUpdateSources("win32", validConfiguration)
		expect(getReleasePageUrl(china!, "0.12.0")).toBe(
			validConfiguration.downloadPageUrl,
		)
		expect(getReleasePageUrl(github!, "0.12.0")).toEndWith(
			"/releases/tag/v0.12.0",
		)
	})
})

describe("update source fallback", () => {
	it("returns the first successful source and records fallback", async () => {
		const sources = createUpdateSources("win32", validConfiguration)
		const attempts: string[] = []
		const result = await runWithUpdateSourceFallback(sources, async (source) => {
			attempts.push(source.id)
			if (source.id === "china") throw new Error("mirror unavailable")
			return "available"
		})

		expect(attempts).toEqual(["china", "github"])
		expect(result).toMatchObject({
			value: "available",
			fallbackUsed: true,
			source: { id: "github" },
		})
	})

	it("does not use the fallback after a successful primary attempt", async () => {
		const sources = createUpdateSources("win32", validConfiguration)
		const attempts: string[] = []
		const result = await runWithUpdateSourceFallback(sources, async (source) => {
			attempts.push(source.id)
			return source.id
		})

		expect(attempts).toEqual(["china"])
		expect(result.fallbackUsed).toBe(false)
	})
})
