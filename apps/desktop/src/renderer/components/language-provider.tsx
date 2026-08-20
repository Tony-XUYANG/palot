/**
 * Boots localization before the rest of the application and owns locale persistence.
 */

import { Button } from "@palot/ui/components/button";
import { CheckIcon, LanguagesIcon } from "lucide-react";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { I18nextProvider } from "react-i18next";
import {
	LANGUAGE_STORAGE_KEY,
	resolveSupportedLocale,
	type SupportedLocale,
} from "../../shared/i18n";
import { appI18n } from "../i18n";
import { PalotWordmark } from "./palot-wordmark";

interface LanguageContextValue {
	language: SupportedLocale;
	setLanguage: (language: SupportedLocale) => Promise<void>;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function useAppLanguage(): LanguageContextValue {
	const value = useContext(LanguageContext);
	if (!value)
		throw new Error("useAppLanguage must be used within LanguageProvider");
	return value;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
	const suggestedLanguage = useMemo(
		() => resolveSupportedLocale(globalThis.navigator?.language),
		[],
	);
	const [language, setLanguageState] = useState<
		SupportedLocale | null | undefined
	>(undefined);

	useEffect(() => {
		let active = true;
		const palot = window.palot;

		const applyLanguage = async (next: SupportedLocale | null) => {
			await appI18n.changeLanguage(next ?? suggestedLanguage);
			document.documentElement.lang = next ?? suggestedLanguage;
			if (next === null) document.getElementById("splash")?.remove();
			if (active) setLanguageState(next);
		};

		if (palot?.getSettings) {
			palot
				.getSettings()
				.then((settings) => applyLanguage(settings.language))
				.catch(() => applyLanguage(null));
			const unsubscribe = palot.onSettingsChanged((settings) => {
				void applyLanguage(settings.language);
			});
			return () => {
				active = false;
				unsubscribe();
			};
		}

		const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
		void applyLanguage(stored ? resolveSupportedLocale(stored) : null);
		return () => {
			active = false;
		};
	}, [suggestedLanguage]);

	const setLanguage = useCallback(async (next: SupportedLocale) => {
		const palot = window.palot;
		if (palot?.updateSettings) {
			await palot.updateSettings({ language: next });
		} else {
			localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
		}
		await appI18n.changeLanguage(next);
		document.documentElement.lang = next;
		setLanguageState(next);
	}, []);

	if (language === undefined) {
		return <div className="min-h-screen bg-background" aria-hidden="true" />;
	}

	if (language === null) {
		return (
			<I18nextProvider i18n={appI18n}>
				<LanguageSelection
					suggestedLanguage={suggestedLanguage}
					onConfirm={setLanguage}
				/>
			</I18nextProvider>
		);
	}

	const contextValue = { language, setLanguage };

	return (
		<I18nextProvider i18n={appI18n}>
			<LanguageContext.Provider value={contextValue}>
				{children}
			</LanguageContext.Provider>
		</I18nextProvider>
	);
}

function LanguageSelection({
	suggestedLanguage,
	onConfirm,
}: {
	suggestedLanguage: SupportedLocale;
	onConfirm: (language: SupportedLocale) => Promise<void>;
}) {
	const [selected, setSelected] = useState<SupportedLocale>(suggestedLanguage);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState(false);

	const handleConfirm = useCallback(async () => {
		setSaving(true);
		setError(false);
		try {
			await onConfirm(selected);
		} catch {
			setError(true);
			setSaving(false);
		}
	}, [onConfirm, selected]);

	const options: Array<{
		value: SupportedLocale;
		label: string;
		detail: string;
	}> = [
		{ value: "zh-CN", label: "简体中文", detail: "Chinese (Simplified)" },
		{ value: "en-US", label: "English", detail: "英语" },
	];

	return (
		<main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
			<div className="w-full max-w-md">
				<div className="mb-10 flex items-center justify-center">
					<PalotWordmark className="h-9 w-auto" />
				</div>
				<div className="mb-6 text-center">
					<LanguagesIcon
						aria-hidden="true"
						className="mx-auto mb-4 size-7 text-muted-foreground"
					/>
					<h1 className="text-2xl font-semibold">
						选择语言 / Choose your language
					</h1>
					<p className="mt-2 text-sm text-muted-foreground">
						之后可以在设置中更改 / You can change this later in Settings
					</p>
				</div>

				<div
					className="grid grid-cols-2 gap-2"
					role="radiogroup"
					aria-label="Language"
				>
					{options.map((option) => {
						const active = selected === option.value;
						return (
							<button
								key={option.value}
								type="button"
								role="radio"
								aria-checked={active}
								onClick={() => setSelected(option.value)}
								className={`relative min-h-24 rounded-md border px-4 py-4 text-left transition-colors ${
									active
										? "border-primary bg-accent text-accent-foreground"
										: "border-border hover:bg-accent/50"
								}`}
							>
								{active ? (
									<CheckIcon
										aria-hidden="true"
										className="absolute right-3 top-3 size-4"
									/>
								) : null}
								<span className="block font-medium">{option.label}</span>
								<span className="mt-1 block text-xs text-muted-foreground">
									{option.detail}
								</span>
							</button>
						);
					})}
				</div>

				{error ? (
					<p className="mt-4 text-center text-sm text-destructive" role="alert">
						无法保存语言设置，请重试 / Could not save the language setting.
						Please try again.
					</p>
				) : null}

				<Button
					className="mt-6 w-full"
					disabled={saving}
					onClick={handleConfirm}
				>
					{saving ? "正在保存... / Saving..." : "继续 / Continue"}
				</Button>
			</div>
		</main>
	);
}
