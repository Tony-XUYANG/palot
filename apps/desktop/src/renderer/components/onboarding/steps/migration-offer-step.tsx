/**
 * Multi-provider Migration Offer.
 *
 * Scans the selected provider's configuration and lets the user select which
 * categories to migrate to OpenCode format. The user explicitly opted in
 * (from the complete step), so scanning happens on mount.
 */

import { Button } from "@palot/ui/components/button";
import { Checkbox } from "@palot/ui/components/checkbox";
import { Spinner } from "@palot/ui/components/spinner";
import type { TFunction } from "i18next";
import {
	ArrowRightIcon,
	BotIcon,
	CogIcon,
	FileTextIcon,
	FolderOpenIcon,
	PlugIcon,
	ScrollTextIcon,
	ServerIcon,
	ShieldIcon,
	TerminalIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	MigrationPreview,
	MigrationProvider,
	ProviderDetection,
} from "../../../../preload/api";

// ============================================================
// Types
// ============================================================

interface MigrationCategory {
	id: string;
	label: string;
	description: string;
	icon: typeof CogIcon;
	count: number;
	enabled: boolean;
}

interface MigrationOfferStepProps {
	provider: MigrationProvider;
	onPreview: (
		scanResult: unknown,
		categories: string[],
		preview: MigrationPreview,
	) => void;
	onSkip: () => void;
}

// ============================================================
// Provider display metadata
// ============================================================

const PROVIDER_LABELS: Record<MigrationProvider, string> = {
	"claude-code": "Claude Code",
	cursor: "Cursor",
	opencode: "OpenCode",
};

// ============================================================
// Component
// ============================================================

export function MigrationOfferStep({
	provider,
	onPreview,
	onSkip,
}: MigrationOfferStepProps) {
	const { t } = useTranslation();
	const [categories, setCategories] = useState<MigrationCategory[]>([]);
	const [scanning, setScanning] = useState(false);
	const [scanError, setScanError] = useState<string | null>(null);
	const [previewing, setPreviewing] = useState(false);
	const hasScanned = useRef(false);
	const scanResultRef = useRef<unknown>(null);

	const isElectron = typeof window !== "undefined" && "palot" in window;
	const label = PROVIDER_LABELS[provider];

	// Run full scan on mount (user explicitly opted in)
	useEffect(() => {
		if (!isElectron || hasScanned.current) return;
		hasScanned.current = true;
		setScanning(true);

		window.palot.onboarding
			.scanProvider(provider)
			.then(({ detection, scanResult }) => {
				scanResultRef.current = scanResult;
				setCategories(buildCategories(provider, detection, t));
				setScanning(false);
			})
			.catch((err) => {
				setScanError(
					err instanceof Error
						? err.message
						: t("onboarding.migration.scanFailed", { error: "unknown error" }),
				);
				setScanning(false);
			});
	}, [isElectron, provider]);

	const toggleCategory = useCallback((id: string) => {
		setCategories((prev) =>
			prev.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c)),
		);
	}, []);

	const handlePreview = useCallback(async () => {
		if (!isElectron || !scanResultRef.current) return;
		setPreviewing(true);
		setScanError(null);

		const selectedIds = categories.filter((c) => c.enabled).map((c) => c.id);

		try {
			const preview = await window.palot.onboarding.previewMigration(
				provider,
				scanResultRef.current,
				selectedIds,
			);
			onPreview(scanResultRef.current, selectedIds, preview);
		} catch (err) {
			setScanError(
				err instanceof Error
					? err.message
					: t("onboarding.migration.previewFailed", { error: "unknown error" }),
			);
		} finally {
			setPreviewing(false);
		}
	}, [isElectron, provider, categories, onPreview]);

	const enabledCount = categories.filter((c) => c.enabled).length;

	return (
		<div className="flex h-full flex-col items-center justify-center px-6">
			<div className="w-full max-w-lg space-y-6">
				<div className="text-center">
					<h2 className="text-xl font-semibold text-foreground">
						{t("onboarding.migration.offerTitle", { provider: label })}
					</h2>
					<p className="mt-1 text-sm text-muted-foreground">
						{t("onboarding.migration.offerDescription", { provider: label })}
					</p>
				</div>

				{/* Loading state */}
				{scanning && (
					<div
						data-slot="onboarding-card"
						className="flex items-center justify-center gap-3 rounded-lg border border-border bg-muted/30 p-6"
					>
						<Spinner className="size-4" />
						<span className="text-sm text-muted-foreground">
							{t("onboarding.migration.scanning", { provider: label })}
						</span>
					</div>
				)}

				{/* Category checkboxes */}
				{!scanning && categories.length > 0 && (
					<div className="space-y-2">
						{categories.map((cat) => {
							if (cat.count === 0) return null;
							const Icon = cat.icon;
							return (
								<button
									type="button"
									key={cat.id}
									data-slot="onboarding-card"
									onClick={() => toggleCategory(cat.id)}
									className="flex w-full cursor-pointer items-center gap-3 rounded-lg border border-border bg-background p-3 text-left transition-colors hover:bg-muted/30"
								>
									<Checkbox
										checked={cat.enabled}
										onCheckedChange={() => toggleCategory(cat.id)}
										aria-label={cat.label}
									/>
									<Icon
										aria-hidden="true"
										className="size-4 shrink-0 text-muted-foreground"
									/>
									<div className="min-w-0 flex-1">
										<p className="text-sm font-medium text-foreground">
											{cat.label}
										</p>
										<p className="text-xs text-muted-foreground">
											{cat.description}
										</p>
									</div>
									<span className="shrink-0 text-xs tabular-nums text-muted-foreground">
										{cat.count}
									</span>
								</button>
							);
						})}
					</div>
				)}

				{/* Info about what migration does */}
				{!scanning && categories.length > 0 && (
					<div
						data-slot="onboarding-card"
						className="rounded-lg border border-border bg-muted/20 p-3"
					>
						<p className="text-xs leading-relaxed text-muted-foreground">
							{getMigrationDescription(provider, t)}
						</p>
					</div>
				)}

				{/* Error */}
				{scanError && (
					<div className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-500">
						{scanError}
					</div>
				)}

				{/* Actions */}
				<div className="flex items-center justify-center gap-3">
					<Button variant="outline" onClick={onSkip}>
						{t("onboarding.migration.back")}
					</Button>
					{!scanning && categories.length > 0 && (
						<Button
							onClick={handlePreview}
							disabled={enabledCount === 0 || previewing}
							className="gap-2"
						>
							{previewing ? (
								<>
									<Spinner className="size-3.5" />
									{t("onboarding.migration.preparing")}
								</>
							) : (
								<>
									{t("onboarding.migration.preview")}
									<ArrowRightIcon aria-hidden="true" className="size-4" />
								</>
							)}
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}

// ============================================================
// Helpers
// ============================================================

function getMigrationDescription(
	provider: MigrationProvider,
	t: TFunction,
): string {
	switch (provider) {
		case "claude-code":
			return t("onboarding.migration.claudeDescription");
		case "cursor":
			return t("onboarding.migration.cursorDescription");
		case "opencode":
			return t("onboarding.migration.opencodeDescription");
	}
}

function buildCategories(
	provider: MigrationProvider,
	detection: ProviderDetection,
	t: TFunction,
): MigrationCategory[] {
	switch (provider) {
		case "claude-code":
			return buildClaudeCodeCategories(detection, t);
		case "cursor":
			return buildCursorCategories(detection, t);
		case "opencode":
			return buildOpenCodeCategories(detection, t);
	}
}

function buildClaudeCodeCategories(
	detection: ProviderDetection,
	t: TFunction,
): MigrationCategory[] {
	const historyParts: string[] = [];
	if (detection.projectCount > 0) {
		historyParts.push(
			t("onboarding.migration.projectCount", { count: detection.projectCount }),
		);
	}
	if (detection.totalSessions > 0) {
		historyParts.push(
			t("onboarding.migration.sessionCount", {
				count: detection.totalSessions,
			}),
		);
	}

	return [
		{
			id: "config",
			label: t("onboarding.migration.categories.globalSettings"),
			description: t(
				"onboarding.migration.categories.globalSettingsDescription",
			),
			icon: CogIcon,
			count: detection.hasGlobalSettings ? 1 : 0,
			enabled: true,
		},
		{
			id: "mcp",
			label: t("onboarding.migration.categories.mcp"),
			description: t("onboarding.migration.categories.mcpDescription"),
			icon: ServerIcon,
			count: detection.mcpServerCount,
			enabled: true,
		},
		{
			id: "history",
			label: "Projects & sessions",
			description:
				historyParts.length > 0
					? historyParts.join(", ")
					: t("onboarding.migration.noSessions"),
			icon: FolderOpenIcon,
			count: detection.totalSessions,
			enabled: detection.totalSessions > 0,
		},
		{
			id: "agents",
			label: t("onboarding.migration.categories.agents"),
			description: t("onboarding.migration.categories.agentsDescription"),
			icon: BotIcon,
			count: detection.agentCount,
			enabled: true,
		},
		{
			id: "commands",
			label: t("onboarding.migration.categories.commands"),
			description: t("onboarding.migration.categories.commandsDescription"),
			icon: TerminalIcon,
			count: detection.commandCount,
			enabled: true,
		},
		{
			id: "rules",
			label: t("onboarding.migration.categories.claudeRules"),
			description: t("onboarding.migration.categories.claudeRulesDescription"),
			icon: ScrollTextIcon,
			count: detection.ruleCount,
			enabled: true,
		},
		{
			id: "permissions",
			label: t("onboarding.migration.categories.permissions"),
			description: t("onboarding.migration.categories.permissionsDescription"),
			icon: ShieldIcon,
			count: detection.hasGlobalSettings ? 1 : 0,
			enabled: true,
		},
		{
			id: "hooks",
			label: t("onboarding.migration.categories.hooks"),
			description: t("onboarding.migration.categories.hooksDescription"),
			icon: PlugIcon,
			count: detection.hasHooks ? 1 : 0,
			enabled: true,
		},
		{
			id: "skills",
			label: t("onboarding.migration.categories.skills"),
			description: t("onboarding.migration.categories.skillsDescription"),
			icon: FileTextIcon,
			count: detection.skillCount,
			enabled: true,
		},
	];
}

function buildCursorCategories(
	detection: ProviderDetection,
	t: TFunction,
): MigrationCategory[] {
	const historyParts: string[] = [];
	if (detection.totalSessions > 0) {
		historyParts.push(
			t("onboarding.migration.sessionCount", {
				count: detection.totalSessions,
			}),
		);
	}
	if (detection.totalMessages > 0) {
		historyParts.push(
			t("onboarding.migration.messageCount", {
				count: detection.totalMessages,
			}),
		);
	}

	return [
		{
			id: "config",
			label: t("onboarding.migration.categories.globalPermissions"),
			description: t(
				"onboarding.migration.categories.globalPermissionsDescription",
			),
			icon: CogIcon,
			count: detection.hasGlobalSettings ? 1 : 0,
			enabled: true,
		},
		{
			id: "mcp",
			label: t("onboarding.migration.categories.mcp"),
			description: t("onboarding.migration.categories.mcpDescription"),
			icon: ServerIcon,
			count: detection.mcpServerCount,
			enabled: true,
		},
		{
			id: "history",
			label: "Chat history",
			description:
				historyParts.length > 0
					? historyParts.join(", ")
					: t("onboarding.migration.noChatSessions"),
			icon: FolderOpenIcon,
			count: detection.totalSessions,
			enabled: detection.totalSessions > 0,
		},
		{
			id: "agents",
			label: t("onboarding.migration.categories.agents"),
			description: t("onboarding.migration.categories.cursorAgentsDescription"),
			icon: BotIcon,
			count: detection.agentCount,
			enabled: true,
		},
		{
			id: "commands",
			label: t("onboarding.migration.categories.commands"),
			description: t(
				"onboarding.migration.categories.cursorCommandsDescription",
			),
			icon: TerminalIcon,
			count: detection.commandCount,
			enabled: true,
		},
		{
			id: "rules",
			label: t("onboarding.migration.categories.cursorRules"),
			description: t("onboarding.migration.categories.cursorRulesDescription"),
			icon: ScrollTextIcon,
			count: detection.ruleCount,
			enabled: true,
		},
		{
			id: "permissions",
			label: t("onboarding.migration.categories.permissions"),
			description: t(
				"onboarding.migration.categories.cursorPermissionsDescription",
			),
			icon: ShieldIcon,
			count: detection.hasPermissions ? 1 : 0,
			enabled: true,
		},
		{
			id: "skills",
			label: t("onboarding.migration.categories.skills"),
			description: t("onboarding.migration.categories.skillsDescription"),
			icon: FileTextIcon,
			count: detection.skillCount,
			enabled: true,
		},
	];
}

function buildOpenCodeCategories(
	detection: ProviderDetection,
	t: TFunction,
): MigrationCategory[] {
	return [
		{
			id: "config",
			label: t("onboarding.migration.categories.globalConfiguration"),
			description: t(
				"onboarding.migration.categories.globalConfigurationDescription",
			),
			icon: CogIcon,
			count: detection.hasGlobalSettings ? 1 : 0,
			enabled: true,
		},
		{
			id: "mcp",
			label: t("onboarding.migration.categories.mcp"),
			description: t("onboarding.migration.categories.mcpDescription"),
			icon: ServerIcon,
			count: detection.mcpServerCount,
			enabled: true,
		},
		{
			id: "agents",
			label: t("onboarding.migration.categories.agents"),
			description: t(
				"onboarding.migration.categories.opencodeAgentsDescription",
			),
			icon: BotIcon,
			count: detection.agentCount,
			enabled: true,
		},
		{
			id: "commands",
			label: t("onboarding.migration.categories.commands"),
			description: t(
				"onboarding.migration.categories.opencodeCommandsDescription",
			),
			icon: TerminalIcon,
			count: detection.commandCount,
			enabled: true,
		},
		{
			id: "rules",
			label: t("onboarding.migration.categories.rules"),
			description: t("onboarding.migration.categories.rulesDescription"),
			icon: ScrollTextIcon,
			count: detection.ruleCount,
			enabled: true,
		},
		{
			id: "skills",
			label: t("onboarding.migration.categories.skills"),
			description: t("onboarding.migration.categories.skillsDescription"),
			icon: FileTextIcon,
			count: detection.skillCount,
			enabled: true,
		},
	];
}
