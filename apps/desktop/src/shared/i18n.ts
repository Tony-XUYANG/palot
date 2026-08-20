/**
 * Shared locale types and resolution helpers used by both Electron processes.
 */

export const SUPPORTED_LOCALES = ["zh-CN", "en-US"] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = "en-US";
export const LANGUAGE_STORAGE_KEY = "palot:language";

export function isSupportedLocale(value: unknown): value is SupportedLocale {
	return (
		typeof value === "string" &&
		SUPPORTED_LOCALES.includes(value as SupportedLocale)
	);
}

export function resolveSupportedLocale(value: unknown): SupportedLocale {
	if (isSupportedLocale(value)) return value;
	if (typeof value === "string" && value.toLowerCase().startsWith("zh"))
		return "zh-CN";
	return DEFAULT_LOCALE;
}
