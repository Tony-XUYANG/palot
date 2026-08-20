/**
 * Pure update-source configuration and fallback helpers.
 */

import { isIP } from "node:net"
import type { GenericServerOptions, GithubOptions } from "builder-util-runtime"

export type UpdateSourceId = "china" | "github"

export interface UpdateSource {
	id: UpdateSourceId
	feed: GenericServerOptions | GithubOptions
	releasePageUrl: string
}

export interface ChinaUpdateConfiguration {
	updateBaseUrl: string
	downloadPageUrl: string
}

interface EmbeddedUpdateConfiguration {
	updateBaseUrl?: string
	downloadPageUrl?: string
}

export interface UpdateSourceAttempt<T> {
	value: T
	source: UpdateSource
	fallbackUsed: boolean
}

const GITHUB_REPOSITORY_URL = "https://github.com/Tony-XUYANG/palot"

export const GITHUB_UPDATE_SOURCE: UpdateSource = {
	id: "github",
	feed: {
		provider: "github",
		owner: "Tony-XUYANG",
		repo: "palot",
	},
	releasePageUrl: `${GITHUB_REPOSITORY_URL}/releases/latest`,
}

function parsePublicHttpsUrl(value: string, label: string): URL {
	let url: URL
	try {
		url = new URL(value)
	} catch {
		throw new Error(`${label} must be a valid HTTPS URL`)
	}

	if (url.protocol !== "https:") {
		throw new Error(`${label} must use HTTPS`)
	}
	if (url.username || url.password) {
		throw new Error(`${label} must not contain credentials`)
	}
	if (url.hash) {
		throw new Error(`${label} must not contain a fragment`)
	}

	const hostname = url.hostname.toLowerCase().replace(/\.$/, "")
	const ipCandidate = hostname.replace(/^\[|\]$/g, "")
	if (
		hostname === "localhost" ||
		hostname.endsWith(".localhost") ||
		isIP(ipCandidate)
	) {
		throw new Error(`${label} must use a public hostname`)
	}

	return url
}

export function parseChinaUpdateConfiguration(
	configuration: EmbeddedUpdateConfiguration,
): ChinaUpdateConfiguration | null {
	const updateBaseUrl = configuration.updateBaseUrl?.trim() ?? ""
	const downloadPageUrl = configuration.downloadPageUrl?.trim() ?? ""

	if (!updateBaseUrl && !downloadPageUrl) return null
	if (!updateBaseUrl || !downloadPageUrl) {
		throw new Error(
			"PALOT_CN_UPDATE_BASE_URL and PALOT_CN_DOWNLOAD_PAGE_URL must be configured together",
		)
	}

	const updateUrl = parsePublicHttpsUrl(updateBaseUrl, "PALOT_CN_UPDATE_BASE_URL")
	const downloadUrl = parsePublicHttpsUrl(
		downloadPageUrl,
		"PALOT_CN_DOWNLOAD_PAGE_URL",
	)

	if (updateUrl.search) {
		throw new Error("PALOT_CN_UPDATE_BASE_URL must not contain a query")
	}
	updateUrl.pathname = updateUrl.pathname.replace(/\/+$/, "") || "/"

	return {
		updateBaseUrl: updateUrl.toString().replace(/\/$/, ""),
		downloadPageUrl: downloadUrl.toString(),
	}
}

export function createUpdateSources(
	platform: NodeJS.Platform,
	configuration: EmbeddedUpdateConfiguration,
): UpdateSource[] {
	if (platform !== "win32") return [GITHUB_UPDATE_SOURCE]

	const china = parseChinaUpdateConfiguration(configuration)
	if (!china) return [GITHUB_UPDATE_SOURCE]

	return [
		{
			id: "china",
			feed: {
				provider: "generic",
				url: china.updateBaseUrl,
				channel: "latest",
				useMultipleRangeRequest: false,
			},
			releasePageUrl: china.downloadPageUrl,
		},
		GITHUB_UPDATE_SOURCE,
	]
}

export async function runWithUpdateSourceFallback<T>(
	sources: UpdateSource[],
	operation: (source: UpdateSource, fallbackUsed: boolean) => Promise<T>,
): Promise<UpdateSourceAttempt<T>> {
	if (sources.length === 0) throw new Error("No update source is configured")

	let lastError: unknown
	for (const [index, source] of sources.entries()) {
		try {
			return {
				value: await operation(source, index > 0),
				source,
				fallbackUsed: index > 0,
			}
		} catch (error) {
			lastError = error
		}
	}

	throw lastError instanceof Error ? lastError : new Error("All update sources failed")
}

export function getReleasePageUrl(source: UpdateSource, version?: string): string {
	if (source.id === "github" && version) {
		return `${GITHUB_REPOSITORY_URL}/releases/tag/v${version}`
	}
	return source.releasePageUrl
}

declare const __PALOT_CN_UPDATE_BASE_URL__: string
declare const __PALOT_CN_DOWNLOAD_PAGE_URL__: string

export function getEmbeddedUpdateConfiguration(): EmbeddedUpdateConfiguration {
	return {
		updateBaseUrl:
			typeof __PALOT_CN_UPDATE_BASE_URL__ === "string"
				? __PALOT_CN_UPDATE_BASE_URL__
				: "",
		downloadPageUrl:
			typeof __PALOT_CN_DOWNLOAD_PAGE_URL__ === "string"
				? __PALOT_CN_DOWNLOAD_PAGE_URL__
				: "",
	}
}
