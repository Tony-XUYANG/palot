import { describe, expect, it } from "bun:test"
import { validateChinaDistributionEnvironment } from "./validate-china-distribution"

const enabledEnvironment = {
	PALOT_CN_UPDATE_BASE_URL: "https://download.example.cn/palot/windows",
	PALOT_CN_DOWNLOAD_PAGE_URL: "https://palot.example.cn/download",
	ALIYUN_OSS_REGION: "oss-cn-hangzhou",
	ALIYUN_OSS_BUCKET: "palot-release",
}

describe("China distribution build validation", () => {
	it("allows a GitHub-only build when both Palot URLs are empty", () => {
		expect(validateChinaDistributionEnvironment({})).toBe("disabled")
	})

	it("accepts a complete domestic distribution configuration", () => {
		expect(validateChinaDistributionEnvironment(enabledEnvironment)).toBe("enabled")
	})

	it("rejects partial URLs and missing OSS routing variables", () => {
		expect(() =>
			validateChinaDistributionEnvironment({
				PALOT_CN_UPDATE_BASE_URL: enabledEnvironment.PALOT_CN_UPDATE_BASE_URL,
			}),
		).toThrow("configured together")
		expect(() =>
			validateChinaDistributionEnvironment({
				...enabledEnvironment,
				ALIYUN_OSS_BUCKET: "",
			}),
		).toThrow("ALIYUN_OSS_BUCKET")
	})

	it("requires a non-root object prefix", () => {
		expect(() =>
			validateChinaDistributionEnvironment({
				...enabledEnvironment,
				PALOT_CN_UPDATE_BASE_URL: "https://download.example.cn/",
			}),
		).toThrow("non-root")
	})
})
