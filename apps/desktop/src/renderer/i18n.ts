/**
 * Renderer i18next instance with all resources bundled for offline use.
 */

import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { DEFAULT_LOCALE } from "../shared/i18n";
import { resources } from "../shared/i18n-resources";

export const appI18n = i18next.createInstance();

void appI18n.use(initReactI18next).init({
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
