/**
 * Upload a Windows release to an Alibaba OSS-backed generic update feed.
 */

const fs = require("node:fs")
const { isIP } = require("node:net")
const path = require("node:path")
const OSS = require("ali-oss")

const MUTABLE_CACHE_CONTROL = "no-cache, no-store, must-revalidate"
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable"

function parseArguments(argv) {
	const result = { directory: "release-files", version: "" }
	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index]
		if (argument === "--directory") {
			result.directory = argv[++index] ?? ""
		} else if (argument === "--version") {
			result.version = argv[++index] ?? ""
		} else {
			throw new Error(`Unknown argument: ${argument}`)
		}
	}

	if (!result.directory) throw new Error("--directory is required")
	if (!/^[0-9A-Za-z.-]+$/.test(result.version)) {
		throw new Error("--version must contain only release-version characters")
	}
	return result
}

function parsePublicHttpsUrl(value, label) {
	let url
	try {
		url = new URL(value)
	} catch {
		throw new Error(`${label} must be a valid HTTPS URL`)
	}
	if (url.protocol !== "https:") throw new Error(`${label} must use HTTPS`)
	if (url.username || url.password) throw new Error(`${label} must not contain credentials`)
	if (url.hash) throw new Error(`${label} must not contain a fragment`)

	const hostname = url.hostname.toLowerCase().replace(/\.$/, "")
	const ipCandidate = hostname.replace(/^\[|\]$/g, "")
	if (hostname === "localhost" || hostname.endsWith(".localhost") || isIP(ipCandidate)) {
		throw new Error(`${label} must use a public hostname`)
	}
	return url
}

function deriveObjectPrefix(updateBaseUrl) {
	const url = parsePublicHttpsUrl(updateBaseUrl, "PALOT_CN_UPDATE_BASE_URL")
	if (url.search) throw new Error("PALOT_CN_UPDATE_BASE_URL must not contain a query")

	const prefix = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, "")
	if (!prefix) {
		throw new Error("PALOT_CN_UPDATE_BASE_URL must include a non-root object prefix")
	}
	if (prefix.split("/").some((segment) => segment === "." || segment === "..")) {
		throw new Error("PALOT_CN_UPDATE_BASE_URL contains an unsafe object prefix")
	}
	return prefix
}

function resolveConfiguration(environment) {
	const required = [
		"PALOT_CN_UPDATE_BASE_URL",
		"ALIYUN_OSS_REGION",
		"ALIYUN_OSS_BUCKET",
		"ALIYUN_OSS_ACCESS_KEY_ID",
		"ALIYUN_OSS_ACCESS_KEY_SECRET",
	]
	for (const name of required) {
		if (!environment[name]?.trim()) throw new Error(`${name} is required`)
	}

	return {
		prefix: deriveObjectPrefix(environment.PALOT_CN_UPDATE_BASE_URL),
		region: environment.ALIYUN_OSS_REGION.trim(),
		bucket: environment.ALIYUN_OSS_BUCKET.trim(),
		accessKeyId: environment.ALIYUN_OSS_ACCESS_KEY_ID.trim(),
		accessKeySecret: environment.ALIYUN_OSS_ACCESS_KEY_SECRET.trim(),
		stsToken: environment.ALIYUN_OSS_STS_TOKEN?.trim() || undefined,
	}
}

function createUploadPlan(directory, version, prefix) {
	const installer = `Palot-${version}-win-x64.exe`
	const names = [
		installer,
		`${installer}.blockmap`,
		"SHA256SUMS.txt",
		"THIRD-PARTY-NOTICES.md",
		"THIRD-PARTY-SOURCE-OFFER.txt",
		"latest.yml",
	]

	return names.map((name) => {
		const filePath = path.resolve(directory, name)
		if (!fs.statSync(filePath, { throwIfNoEntry: false })?.isFile()) {
			throw new Error(`Required China release asset is missing: ${name}`)
		}
		const immutable = name === installer || name.endsWith(".blockmap")
		return {
			name,
			filePath,
			objectName: `${prefix}/${name}`,
			cacheControl: immutable ? IMMUTABLE_CACHE_CONTROL : MUTABLE_CACHE_CONTROL,
		}
	})
}

async function uploadReleaseFiles(client, plan, logger = console) {
	for (const asset of plan) {
		logger.log(`[china-release] Uploading ${asset.objectName}`)
		await client.put(asset.objectName, asset.filePath, {
			headers: { "Cache-Control": asset.cacheControl },
		})
	}
}

async function main(argv = process.argv.slice(2), environment = process.env) {
	const options = parseArguments(argv)
	const configuration = resolveConfiguration(environment)
	const plan = createUploadPlan(options.directory, options.version, configuration.prefix)
	const client = new OSS({
		region: configuration.region,
		bucket: configuration.bucket,
		accessKeyId: configuration.accessKeyId,
		accessKeySecret: configuration.accessKeySecret,
		stsToken: configuration.stsToken,
		secure: true,
	})

	await uploadReleaseFiles(client, plan)
	console.log(`[china-release] Uploaded ${plan.length} Windows release assets`)
}

module.exports = {
	createUploadPlan,
	deriveObjectPrefix,
	main,
	parseArguments,
	resolveConfiguration,
	uploadReleaseFiles,
}

if (require.main === module) {
	main().catch((error) => {
		console.error(`[china-release] ${error instanceof Error ? error.message : "Upload failed"}`)
		process.exitCode = 1
	})
}
