/**
 * Onboarding Step 2: Environment Check.
 *
 * Verifies OpenCode CLI is installed and compatible. Offers install/update
 * if needed. When OpenCode is not found locally, shows any mDNS-discovered
 * servers on the network as an alternative connection path.
 */

import { Button } from "@palot/ui/components/button";
import { Input } from "@palot/ui/components/input";
import { Label } from "@palot/ui/components/label";
import { Spinner } from "@palot/ui/components/spinner";
import { useAtomValue } from "jotai";
import {
	AlertCircleIcon,
	ArrowRightIcon,
	CheckCircle2Icon,
	CircleAlertIcon,
	DownloadIcon,
	GlobeIcon,
	Loader2Icon,
	RadarIcon,
	RefreshCwIcon,
	XCircleIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	OpenCodeCheckResult,
	RemoteServerConfig,
} from "../../../../preload/api";
import { discoveredMdnsServersAtom } from "../../../atoms/connection";
import { useServerActions } from "../../../hooks/use-servers";

// ============================================================
// Types
// ============================================================

type CheckStatus = "pending" | "running" | "success" | "warning" | "error";

interface CheckItem {
	id: string;
	label: string;
	status: CheckStatus;
	detail?: string;
}

interface EnvironmentCheckStepProps {
	onComplete: (version: string | null) => void;
	onSkip: () => void;
}

// ============================================================
// Component
// ============================================================

export function EnvironmentCheckStep({
	onComplete,
	onSkip,
}: EnvironmentCheckStepProps) {
	const { t } = useTranslation("onboarding");
	const [checks, setChecks] = useState<CheckItem[]>([
		{ id: "locate", label: t("environment.locating"), status: "pending" },
		{
			id: "version",
			label: t("environment.checkingVersion"),
			status: "pending",
		},
	]);
	const [openCodeResult, setOpenCodeResult] =
		useState<OpenCodeCheckResult | null>(null);
	const [installing, setInstalling] = useState(false);
	const [installOutput, setInstallOutput] = useState<string[]>([]);
	const [allDone, setAllDone] = useState(false);
	const [savingMdnsId, setSavingMdnsId] = useState<string | null>(null);
	const hasRun = useRef(false);
	const terminalRef = useRef<HTMLDivElement>(null);

	const isElectron = typeof window !== "undefined" && "palot" in window;

	// mDNS discovered servers (scanner starts before onboarding renders)
	const discoveredServers = useAtomValue(discoveredMdnsServersAtom);
	const { saveDiscoveredServer, switchServer, addServer, testConnection } =
		useServerActions();

	// Manual server form state
	const [showManualForm, setShowManualForm] = useState(false);
	const [manualUrl, setManualUrl] = useState("");
	const [manualUsername, setManualUsername] = useState("");
	const [manualPassword, setManualPassword] = useState("");
	const [manualTesting, setManualTesting] = useState(false);
	const [manualTestResult, setManualTestResult] = useState<
		string | null | undefined
	>(undefined);
	const [manualSaving, setManualSaving] = useState(false);

	const updateCheck = useCallback((id: string, update: Partial<CheckItem>) => {
		setChecks((prev) =>
			prev.map((c) => (c.id === id ? { ...c, ...update } : c)),
		);
	}, []);

	// --- Run checks ---

	const runChecks = useCallback(async () => {
		if (!isElectron) return;

		// Reset
		setAllDone(false);
		setOpenCodeResult(null);
		setChecks([
			{ id: "locate", label: t("environment.locating"), status: "running" },
			{
				id: "version",
				label: t("environment.checkingVersion"),
				status: "pending",
			},
		]);

		try {
			// Step 1: Check OpenCode installation
			const result = await window.palot.onboarding.checkOpenCode();
			setOpenCodeResult(result);

			if (!result.installed) {
				updateCheck("locate", {
					status: "error",
					label: t("environment.notFound"),
					detail: t("environment.installToContinue"),
				});
				return;
			}

			updateCheck("locate", {
				status: "success",
				label:
					result.source === "bundled"
						? t("environment.includedVersion", { version: result.version })
						: t("environment.foundVersion", { version: result.version }),
				detail:
					result.source === "bundled"
						? t("environment.included")
						: (result.path ?? undefined),
			});

			// Step 2: Version compatibility
			updateCheck("version", { status: "running" });
			await new Promise((r) => setTimeout(r, 300)); // Brief pause for visual feedback

			if (result.compatibility === "too-old") {
				updateCheck("version", {
					status: "error",
					label: t("environment.incompatible"),
					detail: result.message ?? undefined,
				});
				return;
			}

			if (result.compatibility === "blocked") {
				updateCheck("version", {
					status: "error",
					label: t("environment.blocked"),
					detail: result.message ?? undefined,
				});
				return;
			}

			if (result.compatibility === "too-new") {
				updateCheck("version", {
					status: "warning",
					label: t("environment.newer"),
					detail: result.message ?? undefined,
				});
			} else {
				updateCheck("version", {
					status: "success",
					label: t("environment.compatible"),
				});
			}

			setAllDone(true);
		} catch (err) {
			const message =
				err instanceof Error ? err.message : t("environment.checkFailed");
			updateCheck("locate", { status: "error", detail: message });
		}
	}, [isElectron, updateCheck, t]);

	useEffect(() => {
		if (hasRun.current) return;
		hasRun.current = true;
		runChecks();
	}, [runChecks]);

	// --- Install handler ---

	const handleInstall = useCallback(async () => {
		if (!isElectron) return;
		setInstalling(true);
		setInstallOutput([]);

		const cleanup = window.palot.onboarding.onInstallOutput((text) => {
			setInstallOutput((prev) => [...prev, text]);
		});

		try {
			const result = await window.palot.onboarding.installOpenCode();
			cleanup();

			if (result.success) {
				setInstalling(false);
				// Re-run checks after install
				hasRun.current = false;
				runChecks();
			} else {
				setInstallOutput((prev) => [
					...prev,
					t("environment.installationFailed", {
						error: result.error ?? t("environment.unknownError"),
					}),
				]);
				setInstalling(false);
			}
		} catch (err) {
			cleanup();
			setInstallOutput((prev) => [
				...prev,
				t("environment.error", {
					error:
						err instanceof Error
							? err.message
							: t("environment.installationFailed", {
									error: t("environment.unknownError"),
								}),
				}),
			]);
			setInstalling(false);
		}
	}, [isElectron, runChecks, t]);

	// Auto-scroll terminal when new output arrives
	// biome-ignore lint/correctness/useExhaustiveDependencies: installOutput triggers scroll on new output
	useEffect(() => {
		if (terminalRef.current) {
			terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
		}
	}, [installOutput]);

	// --- Manual server connection ---

	const handleManualTest = useCallback(async () => {
		setManualTesting(true);
		setManualTestResult(undefined);
		const result = await testConnection(
			manualUrl.trim(),
			manualUsername.trim() || undefined,
			manualPassword || undefined,
		);
		setManualTestResult(result);
		setManualTesting(false);
	}, [manualUrl, manualUsername, manualPassword, testConnection]);

	const handleManualConnect = useCallback(async () => {
		if (!isElectron || !manualUrl.trim()) return;

		setManualSaving(true);
		try {
			const id = `remote-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			const url = manualUrl.trim();
			// Derive a name from the URL hostname
			let name = "Remote Server";
			try {
				const parsed = new URL(url);
				name = parsed.hostname;
			} catch {
				// Use default name
			}

			const server: RemoteServerConfig = {
				id,
				name,
				type: "remote",
				url,
				username: manualUsername.trim() || undefined,
				hasPassword: !!manualPassword,
			};

			await addServer(server, manualPassword || undefined);
			await switchServer(id);

			// Skip the environment check since we're using a remote server
			onComplete(null);
		} finally {
			setManualSaving(false);
		}
	}, [
		isElectron,
		manualUrl,
		manualUsername,
		manualPassword,
		addServer,
		switchServer,
		onComplete,
	]);

	// --- Connect to discovered server ---

	const handleConnectDiscovered = useCallback(
		async (mdnsId: string) => {
			const mdnsServer = discoveredServers.find((s) => s.id === mdnsId);
			if (!mdnsServer) return;

			setSavingMdnsId(mdnsId);
			try {
				await saveDiscoveredServer(mdnsServer);

				// The newly saved server gets an auto-generated ID. Find it in settings
				// and switch to it.
				const settings = await window.palot.getSettings();
				const saved = settings.servers?.servers.find(
					(s) =>
						s.type === "remote" &&
						s.url.includes(`:${mdnsServer.port}`) &&
						s.name === mdnsServer.name,
				);
				if (saved) {
					await switchServer(saved.id);
				}

				// Skip the environment check since we're using a remote server
				onComplete(null);
			} finally {
				setSavingMdnsId(null);
			}
		},
		[discoveredServers, saveDiscoveredServer, switchServer, onComplete],
	);

	// --- Render ---

	const needsInstall = openCodeResult && !openCodeResult.installed;
	const needsUpdate = openCodeResult?.compatibility === "too-old";
	const needsRepair = openCodeResult?.repairRequired === true;
	const showInstallUI = (needsInstall || needsUpdate) && !needsRepair;
	const showRemoteOption = showInstallUI && !installing;
	const manualUrlValid = manualUrl.trim().length > 0;

	return (
		<div className="flex h-full flex-col items-center justify-center px-6">
			<div className="w-full max-w-lg space-y-6">
				<div className="text-center">
					<h2 className="text-xl font-semibold text-foreground">
						{t("environment.title")}
					</h2>
					<p className="mt-1 text-sm text-muted-foreground">
						{t("environment.description")}
					</p>
				</div>

				{/* Check list */}
				<div className="space-y-3">
					{checks.map((check) => (
						<div
							key={check.id}
							data-slot="onboarding-card"
							className="flex items-start gap-3 rounded-lg border border-border bg-background p-3"
						>
							<div className="mt-0.5 shrink-0">
								<CheckStatusIcon status={check.status} />
							</div>
							<div className="min-w-0 flex-1">
								<p className="text-sm font-medium text-foreground">
									{check.label}
								</p>
								{check.detail && (
									<p className="mt-0.5 text-xs text-muted-foreground">
										{check.detail}
									</p>
								)}
							</div>
						</div>
					))}
				</div>

				{needsRepair ? (
					<div
						data-slot="onboarding-card"
						className="space-y-2 rounded-lg border border-red-500/40 bg-red-500/5 p-4"
					>
						<div className="flex items-center gap-2 text-sm font-medium text-red-500">
							<CircleAlertIcon aria-hidden="true" className="size-4" />
							{t("environment.repairTitle")}
						</div>
						<p className="text-xs text-muted-foreground">
							{t("environment.repairDescription")}
						</p>
					</div>
				) : null}

				{/* Install UI */}
				{showInstallUI && !installing && (
					<div
						data-slot="onboarding-card"
						className="space-y-3 rounded-lg border border-border bg-muted/30 p-4"
					>
						<p className="text-sm text-muted-foreground">
							{needsUpdate
								? t("environment.oldVersion")
								: t("environment.needsCli")}
						</p>
						<div className="flex gap-2">
							<Button size="sm" onClick={handleInstall} className="gap-2">
								<DownloadIcon aria-hidden="true" className="size-3.5" />
								{needsUpdate
									? t("environment.updateForMe")
									: t("environment.installForMe")}
							</Button>
							<Button size="sm" variant="outline" onClick={onSkip}>
								{needsUpdate
									? t("environment.continueAnyway")
									: t("environment.installManually")}
							</Button>
						</div>
						<p className="text-xs text-muted-foreground/60">
							{t("environment.manualCommand")}
						</p>
					</div>
				)}

				{/* Remote server alternative (shown when CLI is missing) */}
				{showRemoteOption && (
					<div
						data-slot="onboarding-card"
						className="space-y-4 rounded-lg border border-border bg-muted/30 p-4"
					>
						<div className="flex items-center gap-2">
							<GlobeIcon aria-hidden="true" className="size-4 text-primary" />
							<p className="text-sm font-medium text-foreground">
								{t("environment.remoteTitle")}
							</p>
						</div>
						<p className="text-xs text-muted-foreground">
							{t("environment.remoteDescription")}
						</p>

						{/* mDNS discovered servers */}
						{discoveredServers.length > 0 && (
							<div className="space-y-2">
								<p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
									<RadarIcon aria-hidden="true" className="size-3" />
									{t("environment.discovered")}
								</p>
								<div className="space-y-1.5">
									{discoveredServers.map((server) => {
										const displayAddr =
											server.addresses.find((a) => !a.includes(":")) ||
											server.host;
										const isSaving = savingMdnsId === server.id;

										return (
											<button
												key={server.id}
												type="button"
												disabled={isSaving}
												onClick={() => handleConnectDiscovered(server.id)}
												className="flex w-full items-center gap-3 rounded-md border border-border bg-background px-3 py-2.5 text-left transition-colors hover:bg-accent/50 disabled:opacity-50"
											>
												<RadarIcon
													aria-hidden="true"
													className="size-4 shrink-0 text-muted-foreground"
												/>
												<div className="min-w-0 flex-1">
													<p className="truncate text-sm font-medium text-foreground">
														{server.name}
													</p>
													<p className="truncate text-xs text-muted-foreground">
														{displayAddr}:{server.port}
													</p>
												</div>
												{isSaving ? (
													<Loader2Icon
														aria-hidden="true"
														className="size-4 shrink-0 animate-spin text-primary"
													/>
												) : (
													<ArrowRightIcon
														aria-hidden="true"
														className="size-4 shrink-0 text-muted-foreground"
													/>
												)}
											</button>
										);
									})}
								</div>
							</div>
						)}

						{/* Manual connect form */}
						{!showManualForm ? (
							<button
								type="button"
								onClick={() => setShowManualForm(true)}
								className="flex w-full items-center gap-3 rounded-md border border-dashed border-border bg-background px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
							>
								<GlobeIcon aria-hidden="true" className="size-4 shrink-0" />
								<span>{t("environment.manualUrl")}</span>
							</button>
						) : (
							<div className="space-y-3 rounded-md border border-border bg-background p-3">
								<div className="space-y-1.5">
									<Label htmlFor="onboard-url" className="text-xs">
										{t("environment.serverUrl")}
									</Label>
									<Input
										id="onboard-url"
										placeholder="https://opencode.example.com:4096"
										value={manualUrl}
										onChange={(e) => {
											setManualUrl(e.target.value);
											setManualTestResult(undefined);
										}}
										className="h-8 text-sm"
									/>
								</div>
								<div className="grid grid-cols-2 gap-2">
									<div className="space-y-1.5">
										<Label htmlFor="onboard-username" className="text-xs">
											{t("environment.username")}
										</Label>
										<Input
											id="onboard-username"
											placeholder="opencode"
											value={manualUsername}
											onChange={(e) => setManualUsername(e.target.value)}
											className="h-8 text-sm"
										/>
									</div>
									<div className="space-y-1.5">
										<Label htmlFor="onboard-password" className="text-xs">
											{t("environment.password")}
										</Label>
										<Input
											id="onboard-password"
											type="password"
											placeholder={t("environment.optional")}
											value={manualPassword}
											onChange={(e) => setManualPassword(e.target.value)}
											className="h-8 text-sm"
										/>
									</div>
								</div>

								{/* Test result */}
								{manualTestResult === null && (
									<p className="flex items-center gap-1 text-xs text-green-600">
										<CheckCircle2Icon aria-hidden="true" className="size-3" />
										{t("environment.connectionSuccess")}
									</p>
								)}
								{manualTestResult !== null &&
									manualTestResult !== undefined && (
										<p className="flex items-center gap-1 text-xs text-destructive">
											<CircleAlertIcon aria-hidden="true" className="size-3" />
											{manualTestResult}
										</p>
									)}

								<div className="flex gap-2">
									<Button
										size="sm"
										variant="outline"
										disabled={!manualUrlValid || manualTesting}
										onClick={handleManualTest}
									>
										{manualTesting && (
											<Loader2Icon
												aria-hidden="true"
												className="size-3 animate-spin"
											/>
										)}
										{t("environment.test")}
									</Button>
									<Button
										size="sm"
										disabled={!manualUrlValid || manualSaving}
										onClick={handleManualConnect}
									>
										{manualSaving && (
											<Loader2Icon
												aria-hidden="true"
												className="size-3 animate-spin"
											/>
										)}
										{t("common:actions.connect")}
									</Button>
									<Button
										size="sm"
										variant="ghost"
										onClick={() => {
											setShowManualForm(false);
											setManualTestResult(undefined);
										}}
									>
										{t("common:actions.cancel")}
									</Button>
								</div>
							</div>
						)}
					</div>
				)}

				{/* Install terminal output */}
				{(installing || installOutput.length > 0) && (
					<div
						ref={terminalRef}
						className="max-h-48 overflow-y-auto rounded-lg border border-border bg-zinc-950 p-3 font-mono text-xs text-zinc-300"
					>
						{installOutput.map((line, i) => (
							<div
								key={`line-${
									// biome-ignore lint/suspicious/noArrayIndexKey: terminal output lines are append-only
									i
								}`}
								className="whitespace-pre-wrap break-all"
							>
								{line}
							</div>
						))}
						{installing && (
							<div className="mt-1 flex items-center gap-2 text-zinc-400">
								<Spinner className="size-3" />
								{t("environment.installing")}
							</div>
						)}
					</div>
				)}

				{/* Retry / Continue buttons */}
				<div className="flex justify-center gap-3">
					{!allDone && !showInstallUI && !installing && (
						<Button
							size="sm"
							variant="outline"
							onClick={() => {
								hasRun.current = false;
								runChecks();
							}}
							className="gap-2"
						>
							<RefreshCwIcon aria-hidden="true" className="size-3.5" />
							{t("environment.recheck")}
						</Button>
					)}

					{allDone && (
						<Button
							size="default"
							onClick={() => onComplete(openCodeResult?.version ?? null)}
							className="gap-2"
						>
							{t("environment.continue")}
							<ArrowRightIcon aria-hidden="true" className="size-4" />
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}

// ============================================================
// Sub-components
// ============================================================

function CheckStatusIcon({ status }: { status: CheckStatus }) {
	switch (status) {
		case "pending":
			return (
				<div className="size-4 rounded-full border border-muted-foreground/20" />
			);
		case "running":
			return <Spinner className="size-4" />;
		case "success":
			return <CheckCircle2Icon className="size-4 text-emerald-500" />;
		case "warning":
			return <AlertCircleIcon className="size-4 text-amber-500" />;
		case "error":
			return <XCircleIcon className="size-4 text-red-500" />;
	}
}
