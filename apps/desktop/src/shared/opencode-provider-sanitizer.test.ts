import { describe, expect, test } from "bun:test";
import {
	sanitizeOpenCodeProviderPayload,
	sanitizeOpenCodeProviderResponse,
} from "./opencode-provider-sanitizer";

const provider = {
	id: "openai",
	name: "OpenAI",
	source: "config",
	api: "https://api.openai.com/v1",
	npm: "@ai-sdk/openai",
	env: ["OPENAI_API_KEY"],
	key: "secret-provider-key",
	options: {
		apiKey: "secret-option-key",
		baseURL: "https://api.openai.com/v1",
	},
	models: {
		"gpt-codex": {
			id: "gpt-codex",
			name: "GPT Codex",
			headers: { authorization: "Bearer secret-model-header" },
			tool_call: true,
		},
	},
};

describe("OpenCode provider response sanitizer", () => {
	test("allowlists the provider catalog before it reaches Renderer state", () => {
		const result = sanitizeOpenCodeProviderPayload("/provider/", {
			all: [provider],
			default: { openai: "gpt-codex", ignored: 42 },
			connected: ["openai", 42],
		}) as Record<string, unknown>;
		const sanitized = (result.all as Array<Record<string, unknown>>)[0];
		const model = (sanitized.models as Record<string, Record<string, unknown>>)[
			"gpt-codex"
		];

		expect(sanitized).toEqual({
			id: "openai",
			name: "OpenAI",
			api: "https://api.openai.com/v1",
			npm: "@ai-sdk/openai",
			env: ["OPENAI_API_KEY"],
			models: {
				"gpt-codex": { id: "gpt-codex", name: "GPT Codex", tool_call: true },
			},
		});
		expect("key" in sanitized).toBe(false);
		expect("options" in sanitized).toBe(false);
		expect("headers" in model).toBe(false);
		expect(result.default).toEqual({ openai: "gpt-codex" });
		expect(result.connected).toEqual(["openai"]);
	});

	test("allowlists configured providers and removes credential fields", () => {
		const result = sanitizeOpenCodeProviderPayload("/config/providers", {
			providers: [provider],
			default: { openai: "gpt-codex" },
		}) as Record<string, unknown>;
		const sanitized = (result.providers as Array<Record<string, unknown>>)[0];

		expect(sanitized).toEqual({
			id: "openai",
			name: "OpenAI",
			source: "config",
			env: ["OPENAI_API_KEY"],
			models: {
				"gpt-codex": { id: "gpt-codex", name: "GPT Codex", tool_call: true },
			},
		});
		expect("key" in sanitized).toBe(false);
		expect("options" in sanitized).toBe(false);
	});

	test("sanitizes provider URLs with query strings at the IPC boundary", () => {
		const result = sanitizeOpenCodeProviderResponse(
			"http://127.0.0.1:4101/provider?directory=C%3A%5Cproject",
			200,
			JSON.stringify({ all: [provider], default: {}, connected: ["openai"] }),
		);

		expect(result).not.toContain("secret-provider-key");
		expect(result).not.toContain("secret-option-key");
		expect(result).not.toContain("secret-model-header");
	});

	test("leaves unrelated and unsuccessful responses unchanged", () => {
		const body = JSON.stringify(provider);
		expect(
			sanitizeOpenCodeProviderResponse(
				"http://127.0.0.1:4101/session",
				200,
				body,
			),
		).toBe(body);
		expect(
			sanitizeOpenCodeProviderResponse(
				"http://127.0.0.1:4101/provider",
				500,
				body,
			),
		).toBe(body);
	});

	test("fails closed for malformed successful provider responses", () => {
		expect(() =>
			sanitizeOpenCodeProviderResponse(
				"http://127.0.0.1:4101/provider",
				200,
				"not-json",
			),
		).toThrow("not valid JSON");
	});
});
