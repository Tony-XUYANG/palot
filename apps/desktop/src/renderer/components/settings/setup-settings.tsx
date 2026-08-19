/**
 * Settings tab for environment setup, migration management, and re-running onboarding.
 */

import { Button } from "@palot/ui/components/button";
import { Spinner } from "@palot/ui/components/spinner";
import { useAtomValue, useSetAtom } from "jotai";
import {
	AlertCircleIcon,
	CheckCircle2Icon,
	RefreshCwIcon,
	RotateCcwIcon,
	UndoIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { OpenCodeCheckResult } from "../../../preload/api";
import { onboardingStateAtom } from "../../atoms/onboarding";
import { useAppLanguage } from "../language-provider";
import { SettingsRow } from "./settings-row";
import { SettingsSection } from "./settings-section";

const isElectron = typeof window !== "undefined" && "palot" in window;

// ============================================================
// Provider display metadata
// ============================================================

const PROVIDER_LABELS: Record<string, string> = {
	"claude-code": "Claude Code",
	cursor: "Cursor",
	opencode: "OpenCode",
};

export function SetupSettings() {
	const { t } = useTranslation("settings");
	return (
		<div className="space-y-8">
			<div>
				<h2 className="text-xl font-semibold">{t("setup.title")}</h2>
			</div>

			<OpenCodeStatusSection />
			<MigrationSection />
			<OnboardingSection />
		</div>
	);
}

// ============================================================
// OpenCode CLI status
// ============================================================

function OpenCodeStatusSection() {
	const { t } = useTranslation("settings");
	const [checking, setChecking] = useState(false);
	const [result, setResult] = useState<OpenCodeCheckResult | null>(null);

	const checkStatus = useCallback(async () => {
		if (!isElectron) return;
		setChecking(true);
		try {
			const r = await window.palot.onboarding.checkOpenCode();
			setResult(r);
		} catch {
			// ignore
		} finally {
			setChecking(false);
		}
	}, []);

	useEffect(() => {
		checkStatus();
	}, [checkStatus]);

	return (
		<SettingsSection title="OpenCode CLI">
			<SettingsRow
				label={t("setup.version")}
				description={
					result?.source === "bundled"
						? t("setup.included")
						: (result?.path ?? t("common:states.checking"))
				}
			>
				<div className="flex items-center gap-2">
					{checking ? (
						<Spinner className="size-3.5" />
					) : result?.installed ? (
						<>
							<span className="text-sm text-muted-foreground">
								{result.version && /^\d+\.\d+/.test(result.version)
									? `v${result.version}`
									: result.version}
							</span>
							{result.compatible ? (
								<CheckCircle2Icon className="size-4 text-emerald-500" />
							) : (
								<AlertCircleIcon className="size-4 text-amber-500" />
							)}
						</>
					) : (
						<span className="text-sm text-red-500">{t("setup.notFound")}</span>
					)}
					<Button
						variant="outline"
						size="sm"
						onClick={checkStatus}
						disabled={checking}
						className="gap-1.5"
					>
						<RefreshCwIcon aria-hidden="true" className="size-3" />
						{t("setup.check")}
					</Button>
				</div>
			</SettingsRow>

			{result && !result.compatible && result.message && (
				<div className="px-4 py-2 text-xs text-amber-500">{result.message}</div>
			)}
		</SettingsSection>
	);
}

// ============================================================
// Migration management
// ============================================================

function MigrationSection() {
	const { t } = useTranslation("settings");
	const { language } = useAppLanguage();
	const onboardingState = useAtomValue(onboardingStateAtom);
	const [restoring, setRestoring] = useState(false);
	const [restoreResult, setRestoreResult] = useState<string | null>(null);

	const handleRestore = useCallback(async () => {
		if (!isElectron) return;
		setRestoring(true);
		setRestoreResult(null);
		try {
			const result = await window.palot.onboarding.restoreBackup();
			if (result.success) {
				setRestoreResult(
					t("setup.restoredFiles", { count: result.restored.length }),
				);
			} else {
				setRestoreResult(
					t("setup.restoreErrors", { errors: result.errors.join(", ") }),
				);
			}
		} catch (err) {
			setRestoreResult(
				err instanceof Error ? err.message : t("setup.restoreFailed"),
			);
		} finally {
			setRestoring(false);
		}
	}, [t]);

	const migratedFrom = onboardingState.migratedFrom ?? [];

	if (!onboardingState.migrationPerformed || migratedFrom.length === 0) {
		return (
			<SettingsSection title={t("setup.migration")}>
				<SettingsRow
					label={t("setup.status")}
					description={t("setup.noMigration")}
				>
					<span className="text-sm text-muted-foreground">N/A</span>
				</SettingsRow>
			</SettingsSection>
		);
	}

	const migratedLabels = migratedFrom
		.map((p) => PROVIDER_LABELS[p] ?? p)
		.join(", ");

	return (
		<SettingsSection title={t("setup.migration")}>
			<SettingsRow label={t("setup.migratedFrom")} description={migratedLabels}>
				<CheckCircle2Icon className="size-4 text-emerald-500" />
			</SettingsRow>
			<SettingsRow
				label={t("setup.lastMigrated")}
				description={
					onboardingState.completedAt
						? new Date(onboardingState.completedAt).toLocaleString(language)
						: t("setup.unknown")
				}
			>
				<span className="text-xs text-muted-foreground">
					{t("setup.providerCount", { count: migratedFrom.length })}
				</span>
			</SettingsRow>
			<SettingsRow
				label={t("setup.restoreBackup")}
				description={t("setup.restoreDescription")}
			>
				<div className="flex items-center gap-2">
					{restoreResult && (
						<span className="text-xs text-muted-foreground">
							{restoreResult}
						</span>
					)}
					<Button
						variant="outline"
						size="sm"
						onClick={handleRestore}
						disabled={restoring}
						className="gap-1.5"
					>
						{restoring ? (
							<Spinner className="size-3" />
						) : (
							<UndoIcon aria-hidden="true" className="size-3" />
						)}
						{t("setup.restore")}
					</Button>
				</div>
			</SettingsRow>
		</SettingsSection>
	);
}

// ============================================================
// Re-run onboarding
// ============================================================

function OnboardingSection() {
	const { t } = useTranslation("settings");
	const setOnboardingState = useSetAtom(onboardingStateAtom);

	const handleRerun = useCallback(() => {
		setOnboardingState({
			completed: false,
			completedAt: null,
			skippedSteps: [],
			migrationPerformed: false,
			migratedFrom: [],
			opencodeVersion: null,
			providersConnected: 0,
		});
		// Relaunch the app to show onboarding fresh
		if (isElectron) {
			window.palot.relaunch();
		}
	}, [setOnboardingState]);

	return (
		<SettingsSection title={t("setup.onboarding")}>
			<SettingsRow
				label={t("setup.rerun")}
				description={t("setup.rerunDescription")}
			>
				<Button
					variant="outline"
					size="sm"
					onClick={handleRerun}
					className="gap-1.5"
				>
					<RotateCcwIcon aria-hidden="true" className="size-3" />
					{t("setup.rerun")}
				</Button>
			</SettingsRow>
		</SettingsSection>
	);
}
