/**
 * Converts OpenCode model failures into short, actionable messages.
 */

import type { AssistantMessage } from "./types"

export type ModelError = NonNullable<AssistantMessage["error"]>

const AUTH_PATTERN =
	/(invalid|incorrect|expired|missing).{0,24}(api[ _-]?key|token|credential)|unauthori[sz]ed|authentication failed|invalid_api_key/i
const BALANCE_PATTERN =
	/insufficient.{0,24}(balance|credit|quota)|balance.{0,16}(low|empty|not enough)|billing|payment required|recharge|quota exhausted|no available quota/i
const RATE_LIMIT_PATTERN = /rate[ _-]?limit|too many requests|requests per minute|tokens per minute/i
const UNAVAILABLE_PATTERN =
	/(service|provider|model).{0,24}(unavailable|overloaded)|temporarily unavailable|gateway timeout|bad gateway/i
const NETWORK_PATTERN =
	/(network|fetch failed|connection (?:refused|reset|timed out)|connect timeout|socket hang up|econnrefused|econnreset|enotfound|etimedout|dns)/i
const MODEL_NOT_FOUND_PATTERN =
	/(model).{0,32}(not found|does not exist|is not available|unsupported|unknown)|unknown model/i
const REGION_PATTERN =
	/(unsupported|blocked|restricted).{0,24}(country|region|location)|country.{0,24}(unsupported|not supported)|region.{0,24}(unsupported|not supported)|geo(?:graphic)?(?:ally)? restricted/i
const ACCOUNT_ACCESS_PATTERN =
	/(project|organization|account).{0,32}(not found|disabled|not authorized|no access)|permission denied|does not have access|not authorized to (?:use|access)|model access/i
const OAUTH_PATTERN =
	/(oauth|authorization).{0,32}(denied|expired|failed|incomplete)|access_denied|invalid_grant|redirect_uri_mismatch|device code expired/i

function providerPhrase(providerName?: string): string {
	return providerName ? providerName : "the selected provider"
}

function combinedApiMessage(error: Extract<ModelError, { name: "APIError" }>): string {
	return [error.data.message, error.data.responseBody].filter(Boolean).join(" ")
}

export function formatModelError(error: ModelError, providerName?: string): string {
	const provider = providerPhrase(providerName)

	switch (error.name) {
		case "ProviderAuthError":
			return `Authentication failed for ${provider}. Check the API key in Settings > Providers.`
		case "APIError": {
			const details = combinedApiMessage(error)
			const status = error.data.statusCode
			if (OAUTH_PATTERN.test(details)) {
				return `Browser authorization for ${provider} did not complete. Retry sign-in or use an API key instead.`
			}
			if (REGION_PATTERN.test(details)) {
				return `${provider} is not available for the current account or region. Check the provider's regional requirements or choose another provider.`
			}
			if (status === 401 || AUTH_PATTERN.test(details)) {
				return `Authentication failed for ${provider}. Check the API key in Settings > Providers.`
			}
			if (status === 402 || BALANCE_PATTERN.test(details)) {
				return `No balance or quota is available for ${provider}. Top up the account or choose another provider.`
			}
			if (status === 429 || RATE_LIMIT_PATTERN.test(details)) {
				return `Rate limit reached for ${provider}. Wait a moment or choose another model.`
			}
			if (status === 404 || MODEL_NOT_FOUND_PATTERN.test(details)) {
				return `The selected model is not available from ${provider}. Refresh the model list or choose another model.`
			}
			if (NETWORK_PATTERN.test(details)) {
				return `Palot could not reach ${provider}. Check the network connection and provider endpoint, then try again.`
			}
			if (status === 403 || ACCOUNT_ACCESS_PATTERN.test(details)) {
				return `The current ${provider} account or project does not have access. Check project permissions, billing, and model access.`
			}
			if (
				error.data.isRetryable ||
				(status !== undefined && status >= 500) ||
				UNAVAILABLE_PATTERN.test(details)
			) {
				return `${provider} is temporarily unavailable. Try again or choose another provider.`
			}
			return error.data.message || "The model request failed. Try again or choose another model."
		}
		case "ContextOverflowError":
			return "This conversation is too long for the selected model. Start a new chat or choose a model with a larger context window."
		case "MessageOutputLengthError":
			return "The response exceeded the model output limit. Ask for a shorter response or split the task into smaller steps."
		case "StructuredOutputError":
			return "The model could not produce the required structured response. Try again or choose another model."
		case "MessageAbortedError":
			return "The request was stopped."
		case "UnknownError":
			return error.data.message || "The model request failed. Try again or choose another model."
	}
}

export function formatRequestError(error: unknown, providerName?: string): string {
	const message = error instanceof Error ? error.message : String(error || "")
	const apiError: ModelError = {
		name: "APIError",
		data: {
			message,
			isRetryable: false,
		},
	}
	return formatModelError(apiError, providerName)
}
