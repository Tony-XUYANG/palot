import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@palot/ui/components/select";
import { Switch } from "@palot/ui/components/switch";
import { useAtomValue, useSetAtom } from "jotai";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SupportedLocale } from "../../../shared/i18n";
import {
	type DisplayMode,
	displayModeAtom,
	opaqueWindowsAtom,
} from "../../atoms/preferences";
import { useColorScheme, useSetColorScheme } from "../../hooks/use-theme";
import type { ColorScheme } from "../../lib/themes";
import { fetchOpenInTargets, setOpenInPreferred } from "../../services/backend";
import { useAppLanguage } from "../language-provider";
import { SettingsRow } from "./settings-row";
import { SettingsSection } from "./settings-section";

const isElectron = typeof window !== "undefined" && "palot" in window;

export function GeneralSettings() {
	const { t } = useTranslation("settings");

	return (
		<div className="space-y-8">
			<div>
				<h2 className="text-xl font-semibold">{t("general.title")}</h2>
			</div>

			<SettingsSection>
				<OpenDestinationRow />
			</SettingsSection>

			<SettingsSection title={t("general.appearance")}>
				<LanguageRow />
				<ThemeRow />
				<OpaqueWindowsRow />
				<DisplayModeRow />
			</SettingsSection>
		</div>
	);
}

function OpenDestinationRow() {
	const { t } = useTranslation("settings");
	const [targets, setTargets] = useState<
		{ id: string; label: string; available: boolean }[]
	>([]);
	const [preferred, setPreferred] = useState<string | null>(null);

	useEffect(() => {
		if (!isElectron) return;
		fetchOpenInTargets().then((result) => {
			setTargets(result.targets.filter((t) => t.available));
			setPreferred(result.preferredTarget);
		});
	}, []);

	const handleChange = useCallback(async (value: string) => {
		setPreferred(value);
		await setOpenInPreferred(value);
	}, []);

	if (targets.length === 0) return null;

	return (
		<SettingsRow
			label={t("general.openDestination")}
			description={t("general.openDestinationDescription")}
		>
			<Select
				value={preferred ?? undefined}
				onValueChange={(v) => {
					if (v !== null) handleChange(v);
				}}
			>
				<SelectTrigger className="min-w-[180px]">
					<SelectValue placeholder={t("general.select")} />
				</SelectTrigger>
				<SelectContent>
					{targets.map((t) => (
						<SelectItem key={t.id} value={t.id}>
							{t.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</SettingsRow>
	);
}

function LanguageRow() {
	const { t } = useTranslation("settings");
	const { language, setLanguage } = useAppLanguage();

	return (
		<SettingsRow
			label={t("general.language")}
			description={t("general.languageDescription")}
		>
			<Select
				value={language}
				onValueChange={(value) => {
					if (value) void setLanguage(value as SupportedLocale);
				}}
				items={{ "zh-CN": "简体中文", "en-US": "English" }}
			>
				<SelectTrigger className="min-w-[160px]">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="zh-CN">简体中文</SelectItem>
					<SelectItem value="en-US">English</SelectItem>
				</SelectContent>
			</Select>
		</SettingsRow>
	);
}

function ThemeRow() {
	const { t } = useTranslation("settings");
	const colorScheme = useColorScheme();
	const setColorScheme = useSetColorScheme();

	const options: { value: ColorScheme; label: string; icon: typeof SunIcon }[] =
		[
			{ value: "light", label: t("general.light"), icon: SunIcon },
			{ value: "dark", label: t("general.dark"), icon: MoonIcon },
			{ value: "system", label: t("general.system"), icon: MonitorIcon },
		];

	return (
		<SettingsRow
			label={t("general.theme")}
			description={t("general.themeDescription")}
		>
			<div className="flex items-center rounded-md border border-border">
				{options.map((opt) => {
					const Icon = opt.icon;
					const isActive = colorScheme === opt.value;
					return (
						<button
							key={opt.value}
							type="button"
							onClick={() => setColorScheme(opt.value)}
							className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors first:rounded-l-md last:rounded-r-md ${
								isActive
									? "bg-accent text-accent-foreground font-medium"
									: "text-muted-foreground hover:text-foreground"
							}`}
						>
							<Icon aria-hidden="true" className="size-3.5" />
							{opt.label}
						</button>
					);
				})}
			</div>
		</SettingsRow>
	);
}

function OpaqueWindowsRow() {
	const { t } = useTranslation("settings");
	const opaque = useAtomValue(opaqueWindowsAtom);
	const setOpaque = useSetAtom(opaqueWindowsAtom);

	const handleChange = useCallback(
		async (checked: boolean) => {
			setOpaque(checked);
			if (isElectron) {
				await window.palot.setOpaqueWindows(checked);
				// Requires relaunch -- prompt or auto-relaunch
				window.palot.relaunch();
			}
		},
		[setOpaque],
	);

	return (
		<SettingsRow
			label={t("general.opaque")}
			description={t("general.opaqueDescription")}
		>
			<Switch checked={opaque} onCheckedChange={handleChange} />
		</SettingsRow>
	);
}

function DisplayModeRow() {
	const { t } = useTranslation("settings");
	const displayMode = useAtomValue(displayModeAtom);
	const setDisplayMode = useSetAtom(displayModeAtom);

	return (
		<SettingsRow
			label={t("general.displayMode")}
			description={t("general.displayModeDescription")}
		>
			<Select
				value={displayMode}
				onValueChange={(v) => setDisplayMode(v as DisplayMode)}
				items={{
					default: t("general.defaultMode"),
					verbose: t("general.verboseMode"),
				}}
			>
				<SelectTrigger className="min-w-[140px]">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="default">{t("general.defaultMode")}</SelectItem>
					<SelectItem value="verbose">{t("general.verboseMode")}</SelectItem>
				</SelectContent>
			</Select>
		</SettingsRow>
	);
}
