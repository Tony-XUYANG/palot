const { describe, expect, it } = require("bun:test")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const {
	createUploadPlan,
	deriveObjectPrefix,
	parseArguments,
	resolveConfiguration,
	uploadReleaseFiles,
} = require("./upload-alibaba-oss-release.cjs")

describe("Alibaba OSS release configuration", () => {
	it("derives a non-root object prefix from the public update URL", () => {
		expect(deriveObjectPrefix("https://download.example.cn/releases/windows/")).toBe(
			"releases/windows",
		)
		expect(() => deriveObjectPrefix("https://download.example.cn/")).toThrow("non-root")
		expect(() => deriveObjectPrefix("http://download.example.cn/releases")).toThrow("HTTPS")
		expect(() => deriveObjectPrefix("https://127.0.0.1/releases")).toThrow("public hostname")
	})

	it("requires OSS credentials without exposing their values", () => {
		expect(() =>
			resolveConfiguration({
				PALOT_CN_UPDATE_BASE_URL: "https://download.example.cn/releases/windows",
				ALIYUN_OSS_REGION: "oss-cn-hangzhou",
				ALIYUN_OSS_BUCKET: "palot-release",
				ALIYUN_OSS_ACCESS_KEY_ID: "example-id",
			}),
		).toThrow("ALIYUN_OSS_ACCESS_KEY_SECRET is required")
	})

	it("parses the release directory and version", () => {
		expect(parseArguments(["--directory", "dist", "--version", "0.12.0-beta.6"])).toEqual({
			directory: "dist",
			version: "0.12.0-beta.6",
		})
	})
})

describe("Alibaba OSS release uploads", () => {
	it("uploads immutable assets first and latest.yml last", async () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "palot-oss-test-"))
		const version = "0.12.0-beta.6"
		const installer = `Palot-${version}-win-x64.exe`
		const names = [
			installer,
			`${installer}.blockmap`,
			"SHA256SUMS.txt",
			"THIRD-PARTY-NOTICES.md",
			"THIRD-PARTY-SOURCE-OFFER.txt",
			"latest.yml",
		]
		try {
			for (const name of names) fs.writeFileSync(path.join(directory, name), name)
			const plan = createUploadPlan(directory, version, "releases/windows")
			const uploads = []
			await uploadReleaseFiles(
				{
					put: async (objectName, filePath, options) => {
						uploads.push({ objectName, filePath, options })
					},
				},
				plan,
				{ log: () => {} },
			)

			expect(uploads.map((upload) => upload.objectName)).toEqual(
				names.map((name) => `releases/windows/${name}`),
			)
			expect(uploads[0].options.headers["Cache-Control"]).toContain("immutable")
			expect(uploads.at(-1).objectName).toEndWith("/latest.yml")
			expect(uploads.at(-1).options.headers["Cache-Control"]).toContain("no-cache")
		} finally {
			fs.rmSync(directory, { recursive: true, force: true })
		}
	})

	it("fails before upload when any required asset is missing", () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "palot-oss-test-"))
		try {
			expect(() => createUploadPlan(directory, "0.12.0-beta.6", "releases/windows")).toThrow(
				"missing",
			)
		} finally {
			fs.rmSync(directory, { recursive: true, force: true })
		}
	})
})
