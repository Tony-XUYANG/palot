/**
 * Validation helpers for provider configuration entered in the renderer.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function normalizeProviderBaseUrl(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return "";

	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		throw new Error("Enter a valid provider endpoint URL.");
	}

	const isHttps = url.protocol === "https:";
	const isLoopbackHttp =
		url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
	if (!isHttps && !isLoopbackHttp) {
		throw new Error(
			"Provider endpoints must use HTTPS. HTTP is allowed only for localhost.",
		);
	}
	if (url.username || url.password) {
		throw new Error("Provider endpoint URLs cannot include credentials.");
	}
	if (url.search || url.hash) {
		throw new Error(
			"Provider endpoint URLs cannot include a query string or fragment.",
		);
	}

	return url.toString().replace(/\/$/, "");
}
