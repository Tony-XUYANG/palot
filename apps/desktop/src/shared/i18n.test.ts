import { describe, expect, test } from "bun:test";
import {
	DEFAULT_LOCALE,
	isSupportedLocale,
	resolveSupportedLocale,
	SUPPORTED_LOCALES,
} from "./i18n";
import { enUSResources, resources, zhCNResources } from "./i18n-resources";
import { appI18n } from "../renderer/i18n";

describe("locale helpers", () => {
	test("accepts only supported locales", () => {
		expect(SUPPORTED_LOCALES).toEqual(["zh-CN", "en-US"]);
		expect(isSupportedLocale("zh-CN")).toBe(true);
		expect(isSupportedLocale("en-US")).toBe(true);
		expect(isSupportedLocale("ja-JP")).toBe(false);
		expect(resolveSupportedLocale("zh-TW")).toBe("zh-CN");
		expect(resolveSupportedLocale("unknown")).toBe(DEFAULT_LOCALE);
	});
});

function collectLeafKeys(value: unknown, prefix = ""): string[] {
	if (typeof value === "string") return [prefix];
	if (!value || typeof value !== "object") return [];
	return Object.entries(value).flatMap(([key, child]) =>
		collectLeafKeys(child, prefix ? `${prefix}.${key}` : key),
	);
}

describe("translation resources", () => {
	test("register both locales", () => {
		expect(resources["en-US"]).toBe(enUSResources);
		expect(resources["zh-CN"]).toBe(zhCNResources);
	});

	test("English and Chinese keys stay in sync", () => {
		expect(collectLeafKeys(zhCNResources).sort()).toEqual(
			collectLeafKeys(enUSResources).sort(),
		);
	});

	test("interpolation placeholders stay available", () => {
		expect(enUSResources.deploy.description).toContain("Sealos");
		expect(zhCNResources.onboarding.migration.filesWillCreate).toContain(
			"{{count}}",
		);
		expect(zhCNResources.common.errors.connectionFailed).toContain("{{error}}");
		expect(zhCNResources.sidebar.deleteDescription).toContain("{{name}}");
	});

	test("keeps session actions fully localized", () => {
		expect(zhCNResources.sidebar.rename).toBe("重命名");
		expect(zhCNResources.sidebar.fork).toBe("派生会话");
		expect(zhCNResources.common.actions.delete).toBe("删除");
		expect(zhCNResources.sidebar.deleteTitle).toBe("删除会话？");
		expect(enUSResources.sidebar.deleteFailed).toBe(
			"Could not delete the session",
		);
	});

	test("keeps native application menus fully localized", () => {
		expect(zhCNResources.native.menu.edit).toBe("编辑");
		expect(zhCNResources.native.menu.view).toBe("视图");
		expect(zhCNResources.native.menu.window).toBe("窗口");
		expect(zhCNResources.native.menu.delete).toBe("删除");
	});

	test("resolves full resource paths and active language values", async () => {
		await appI18n.changeLanguage("en-US");
		expect(appI18n.t("common.actions.save")).toBe("Save");
		expect(appI18n.t("common.errors.balance", { provider: "GLM" })).toContain(
			"GLM",
		);
		await appI18n.changeLanguage("zh-CN");
		expect(appI18n.t("common.actions.save")).toBe("保存");
		expect(appI18n.t("native.tray.quit")).toBe("退出");
		expect(appI18n.getFixedT("zh-CN", "settings")("general.language")).toBe(
			"语言",
		);
		expect(appI18n.getFixedT("zh-CN", "onboarding")("welcome.title")).toBe(
			"欢迎使用 Palot",
		);
		await appI18n.changeLanguage(DEFAULT_LOCALE);
	});
});
