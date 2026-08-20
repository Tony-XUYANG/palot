/**
 * Converts OpenCode model failures into short, actionable messages.
 */

import type { AssistantMessage } from "./types";
import { appI18n } from "../i18n";

export type ModelError = NonNullable<AssistantMessage["error"]>;

const AUTH_PATTERN =
	/(invalid|incorrect|expired|missing).{0,24}(api[ _-]?key|token|credential)|unauthori[sz]ed|authentication failed|invalid_api_key/i;
const BALANCE_PATTERN =
	/insufficient.{0,24}(balance|credit|quota)|balance.{0,16}(low|empty|not enough)|billing|payment required|recharge|quota exhausted|no available quota/i;
const RATE_LIMIT_PATTERN =
	/rate[ _-]?limit|too many requests|requests per minute|tokens per minute/i;
const UNAVAILABLE_PATTERN =
	/(service|provider|model).{0,24}(unavailable|overloaded)|temporarily unavailable|gateway timeout|bad gateway/i;
const NETWORK_PATTERN =
	/(network|fetch failed|connection (?:refused|reset|timed out)|connect timeout|socket hang up|econnrefused|econnreset|enotfound|etimedout|dns)/i;
const MODEL_NOT_FOUND_PATTERN =
	/(model).{0,32}(not found|does not exist|is not available|unsupported|unknown)|unknown model/i;
const REGION_PATTERN =
	/(unsupported|blocked|restricted).{0,24}(country|region|location)|country.{0,24}(unsupported|not supported)|region.{0,24}(unsupported|not supported)|geo(?:graphic)?(?:ally)? restricted/i;
const ACCOUNT_ACCESS_PATTERN =
	/(project|organization|account).{0,32}(not found|disabled|not authorized|no access)|permission denied|does not have access|not authorized to (?:use|access)|model access/i;
const OAUTH_PATTERN =
	/(oauth|authorization).{0,32}(denied|expired|failed|incomplete)|access_denied|invalid_grant|redirect_uri_mismatch|device code expired/i;

function providerPhrase(providerName?: string): string {
	return providerName
		? providerName
		: appI18n.t("common.terms.selectedModelProvider");
}

function combinedApiMessage(
	error: Extract<ModelError, { name: "APIError" }>,
): string {
	return [error.data.message, error.data.responseBody]
		.filter(Boolean)
		.join(" ");
}

export function formatModelError(
	error: ModelError,
	providerName?: string,
): string {
	const provider = providerPhrase(providerName);

	switch (error.name) {
		case "ProviderAuthError":
			return appI18n.t("common.errors.providerAuth", { provider });
		case "APIError": {
			const details = combinedApiMessage(error);
			const status = error.data.statusCode;
			if (OAUTH_PATTERN.test(details)) {
				return appI18n.t("common.errors.oauth", { provider });
			}
			if (REGION_PATTERN.test(details)) {
				return appI18n.t("common.errors.region", { provider });
			}
			if (status === 401 || AUTH_PATTERN.test(details)) {
				return appI18n.t("common.errors.providerAuth", { provider });
			}
			if (status === 402 || BALANCE_PATTERN.test(details)) {
				return appI18n.t("common.errors.balance", { provider });
			}
			if (status === 429 || RATE_LIMIT_PATTERN.test(details)) {
				return appI18n.t("common.errors.rateLimit", { provider });
			}
			if (status === 404 || MODEL_NOT_FOUND_PATTERN.test(details)) {
				return appI18n.t("common.errors.modelUnavailable", { provider });
			}
			if (NETWORK_PATTERN.test(details)) {
				return appI18n.t("common.errors.network", { provider });
			}
			if (status === 403 || ACCOUNT_ACCESS_PATTERN.test(details)) {
				return appI18n.t("common.errors.accountAccess", { provider });
			}
			if (
				error.data.isRetryable ||
				(status !== undefined && status >= 500) ||
				UNAVAILABLE_PATTERN.test(details)
			) {
				return appI18n.t("common.errors.temporarilyUnavailable", { provider });
			}
			return (
				error.data.message ||
				appI18n.t("common.errors.modelRequestFailed")
			);
		}
		case "ContextOverflowError":
			return appI18n.t("common.errors.contextOverflow");
		case "MessageOutputLengthError":
			return appI18n.t("common.errors.outputLength");
		case "StructuredOutputError":
			return appI18n.t("common.errors.structuredOutput");
		case "MessageAbortedError":
			return appI18n.t("common.errors.requestStopped");
		case "UnknownError":
			return (
				error.data.message ||
				appI18n.t("common.errors.modelRequestFailed")
			);
	}
}

export function getModelErrorTechnicalDetails(error: ModelError): string | undefined {
	let details: string | undefined;
	switch (error.name) {
		case "ProviderAuthError":
		case "UnknownError":
			details = error.data.message;
			break;
		case "APIError":
			details = combinedApiMessage(error);
			break;
		default:
			return undefined;
	}
	const normalized = details?.trim();
	if (!normalized) return undefined;
	return normalized
		.slice(0, 4000)
		.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
		.replace(
			/(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s,;]+/gi,
			"$1[REDACTED]",
		)
		.replace(
			/((?:api[ _-]?key|access[ _-]?token|refresh[ _-]?token|secret)["']?\s*[:=]\s*["']?)[A-Za-z0-9._~+\/-]{8,}/gi,
			"$1[REDACTED]",
		);
}

export function formatRequestError(
	error: unknown,
	providerName?: string,
): string {
	const message = error instanceof Error ? error.message : String(error || "");
	const apiError: ModelError = {
		name: "APIError",
		data: {
			message,
			isRetryable: false,
		},
	};
	return formatModelError(apiError, providerName);
}
