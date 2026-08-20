/**
 * Main-process localization for native menus, notifications, and dialogs.
 * Resources are bundled so native UI remains available offline.
 */

import i18next, { type i18n as I18nInstance } from "i18next";
import { DEFAULT_LOCALE, type SupportedLocale } from "../shared/i18n";
import { resources } from "../shared/i18n-resources";

const instance: I18nInstance = i18next.createInstance();
let currentLocale: SupportedLocale = DEFAULT_LOCALE;
let initialized = false;
const listeners = new Set<(locale: SupportedLocale) => void>();

void instance.init({
	resources: {
		"en-US": { translation: resources["en-US"], ...resources["en-US"] },
		"zh-CN": { translation: resources["zh-CN"], ...resources["zh-CN"] },
	},
	lng: DEFAULT_LOCALE,
	fallbackLng: DEFAULT_LOCALE,
	defaultNS: "translation",
	ns: ["translation", ...Object.keys(resources[DEFAULT_LOCALE])],
	interpolation: { escapeValue: false },
	returnNull: false,
	initImmediate: false,
});
// With initImmediate=false and in-memory resources, i18next populates its
// resource store synchronously. Mark it ready immediately so the first tray
// menu is translated as well as menus rebuilt after a language change.
initialized = true;

export function setMainLocale(locale: SupportedLocale): void {
	currentLocale = locale;
	void instance.changeLanguage(locale);
	for (const listener of listeners) listener(locale);
}

export function getMainLocale(): SupportedLocale {
	return currentLocale;
}

export function onMainLocaleChanged(
	listener: (locale: SupportedLocale) => void,
): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** Translate a native string. The fallback keeps startup safe before i18next resolves. */
export function tMain(key: string, options?: Record<string, unknown>): string {
	if (!initialized) return key;
	return String(instance.t(key, options));
}
