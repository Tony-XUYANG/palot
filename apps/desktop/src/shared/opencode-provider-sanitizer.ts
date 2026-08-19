/**
 * Removes credential-bearing fields from OpenCode provider responses.
 *
 * Palot only needs provider metadata and model capabilities in the renderer.
 */

const PROVIDER_CATALOG_PATH = "/provider";
const CONFIG_PROVIDERS_PATH = "/config/providers";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function readStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((entry): entry is string => typeof entry === "string");
}

function readStringMap(value: unknown): Record<string, string> {
	if (!isRecord(value)) return {};
	const result: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry === "string") result[key] = entry;
	}
	return result;
}

function sanitizeModels(value: unknown): Record<string, unknown> {
	if (!isRecord(value)) return {};
	const result: Record<string, unknown> = {};
	for (const [modelId, model] of Object.entries(value)) {
		if (!isRecord(model)) continue;
		const { headers: _headers, ...safeModel } = model;
		result[modelId] = safeModel;
	}
	return result;
}

function sanitizeCatalogProvider(value: unknown): JsonRecord | null {
	if (!isRecord(value)) return null;
	const id = readString(value.id);
	const name = readString(value.name);
	if (!id || !name) return null;

	const provider: JsonRecord = {
		id,
		name,
		env: readStringArray(value.env),
		models: sanitizeModels(value.models),
	};
	const api = readString(value.api);
	const npm = readString(value.npm);
	if (api) provider.api = api;
	if (npm) provider.npm = npm;
	return provider;
}

function sanitizeConfiguredProvider(value: unknown): JsonRecord | null {
	if (!isRecord(value)) return null;
	const id = readString(value.id);
	const name = readString(value.name);
	if (!id || !name) return null;

	return {
		id,
		name,
		source: readString(value.source) ?? "custom",
		env: readStringArray(value.env),
		models: sanitizeModels(value.models),
	};
}

function normalizePath(path: string): string {
	const normalized = path.replace(/\/+$/, "");
	return normalized || "/";
}

/** Returns an allowlisted provider response suitable for Renderer state. */
export function sanitizeOpenCodeProviderPayload(
	path: string,
	value: unknown,
): unknown {
	if (!isRecord(value))
		throw new Error("OpenCode provider response must be an object");
	const normalizedPath = normalizePath(path);

	if (normalizedPath === PROVIDER_CATALOG_PATH) {
		const providers = Array.isArray(value.all)
			? value.all.flatMap((provider) => {
					const safe = sanitizeCatalogProvider(provider);
					return safe ? [safe] : [];
				})
			: [];
		return {
			all: providers,
			default: readStringMap(value.default),
			connected: readStringArray(value.connected),
		};
	}

	if (normalizedPath === CONFIG_PROVIDERS_PATH) {
		const providers = Array.isArray(value.providers)
			? value.providers.flatMap((provider) => {
					const safe = sanitizeConfiguredProvider(provider);
					return safe ? [safe] : [];
				})
			: [];
		return {
			providers,
			default: readStringMap(value.default),
		};
	}

	return value;
}

/** Sanitizes successful provider JSON responses crossing the Electron IPC boundary. */
export function sanitizeOpenCodeProviderResponse(
	requestUrl: string,
	status: number,
	body: string | null,
): string | null {
	if (status < 200 || status >= 300 || body === null) return body;

	let path: string;
	try {
		path = normalizePath(new URL(requestUrl).pathname);
	} catch {
		return body;
	}
	if (path !== PROVIDER_CATALOG_PATH && path !== CONFIG_PROVIDERS_PATH)
		return body;

	let value: unknown;
	try {
		value = JSON.parse(body);
	} catch {
		throw new Error("OpenCode provider response was not valid JSON");
	}
	return JSON.stringify(sanitizeOpenCodeProviderPayload(path, value));
}
