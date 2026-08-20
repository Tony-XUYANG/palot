import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appI18n } from "../i18n.ts";
import {
	formatModelError,
	formatRequestError,
	getModelErrorTechnicalDetails,
} from "./model-errors.ts";

describe("model error formatting", () => {
	it("turns authentication failures into a settings action", () => {
		assert.equal(
			formatModelError({
				name: "ProviderAuthError",
				data: { providerID: "deepseek", message: "invalid key" },
			}),
			"Authentication failed for the selected provider. Check the API key in Settings > Providers.",
		);
	});

	it("classifies billing and rate-limit API responses", () => {
		assert.match(
			formatModelError({
				name: "APIError",
				data: {
					message: "Insufficient balance",
					statusCode: 402,
					isRetryable: false,
				},
			}),
			/Top up the account/,
		);
		assert.match(
			formatModelError({
				name: "APIError",
				data: {
					message: "Too many requests",
					statusCode: 429,
					isRetryable: true,
				},
			}),
			/Rate limit reached/,
		);
	});

	it("classifies unavailable models and network failures", () => {
		assert.match(
			formatModelError(
				{
					name: "APIError",
					data: {
						message: "Unknown model",
						statusCode: 404,
						isRetryable: false,
					},
				},
				"Kimi",
			),
			/not available from Kimi/,
		);
		assert.match(
			formatRequestError(new Error("fetch failed"), "GLM"),
			/could not reach GLM/,
		);
	});

	it("keeps unknown request errors useful", () => {
		assert.equal(
			formatRequestError(new Error("Unexpected provider response")),
			"Unexpected provider response",
		);
	});

	it("distinguishes Codex OAuth, region, and project access failures", () => {
		assert.match(
			formatRequestError(
				new Error("OAuth authorization expired"),
				"OpenAI Codex",
			),
			/Retry sign-in or use an API key/,
		);
		assert.match(
			formatModelError(
				{
					name: "APIError",
					data: {
						message: "Country not supported",
						statusCode: 403,
						isRetryable: false,
					},
				},
				"OpenAI Codex",
			),
			/not available for the current account or region/,
		);
		assert.match(
			formatModelError(
				{
					name: "APIError",
					data: {
						message: "Project does not have access to this model",
						statusCode: 403,
						isRetryable: false,
					},
				},
				"OpenAI Codex",
			),
			/account or project does not have access/,
		);
	});

	it("uses the active language and redacts credentials in technical details", async () => {
		await appI18n.changeLanguage("zh-CN");
		assert.match(
			formatRequestError(new Error("fetch failed"), "GLM"),
			/无法连接 GLM/,
		);
		const details = getModelErrorTechnicalDetails({
			name: "APIError",
			data: {
				message: "Authorization: Bearer sk-secret-value-12345678",
				responseBody: '{"api_key":"secret-value-12345678"}',
				isRetryable: false,
			},
		});
		assert.ok(details);
		assert.doesNotMatch(details, /sk-secret|secret-value/);
		assert.match(details, /\[REDACTED\]/);
		await appI18n.changeLanguage("en-US");
	});
});
