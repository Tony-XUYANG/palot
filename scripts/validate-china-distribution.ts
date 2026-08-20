/**
 * Validate build-time China distribution settings without reading secrets.
 */

import { parseChinaUpdateConfiguration } from "../apps/desktop/src/main/update-sources"

export function validateChinaDistributionEnvironment(
	environment: NodeJS.ProcessEnv,
): "disabled" | "enabled" {
	const configuration = parseChinaUpdateConfiguration({
		updateBaseUrl: environment.PALOT_CN_UPDATE_BASE_URL,
		downloadPageUrl: environment.PALOT_CN_DOWNLOAD_PAGE_URL,
	})
	if (!configuration) return "disabled"

	const updateUrl = new URL(configuration.updateBaseUrl)
	const prefix = decodeURIComponent(updateUrl.pathname).replace(/^\/+|\/+$/g, "")
	if (!prefix) {
		throw new Error("PALOT_CN_UPDATE_BASE_URL must include a non-root object prefix")
	}
	if (updateUrl.search) {
		throw new Error("PALOT_CN_UPDATE_BASE_URL must not contain a query")
	}
	if (!environment.ALIYUN_OSS_REGION?.trim()) {
		throw new Error("ALIYUN_OSS_REGION is required when China distribution is enabled")
	}
	if (!environment.ALIYUN_OSS_BUCKET?.trim()) {
		throw new Error("ALIYUN_OSS_BUCKET is required when China distribution is enabled")
	}
	return "enabled"
}

if (import.meta.main) {
	const status = validateChinaDistributionEnvironment(process.env)
	console.log(
		status === "enabled"
			? "China distribution configuration is valid"
			: "China distribution is disabled; Windows updates will use GitHub only",
	)
}
