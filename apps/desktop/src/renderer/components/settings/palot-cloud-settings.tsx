/**
 * Palot Cloud balance, top-up, and connection controls.
 */

import { Button } from "@palot/ui/components/button";
import { Input } from "@palot/ui/components/input";
import { Label } from "@palot/ui/components/label";
import { Spinner } from "@palot/ui/components/spinner";
import { useAtomValue } from "jotai";
import {
	CloudIcon,
	RefreshCwIcon,
	UnplugIcon,
	WalletCardsIcon,
} from "lucide-react";
import { startTransition, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	PalotCloudStatus,
	PalotCloudTopupOrder,
} from "../../../preload/api";
import { isMockModeAtom } from "../../atoms/mock-mode";
import {
	applyPalotCloudProvider,
	disablePalotCloudProvider,
} from "../../lib/palot-cloud";

interface PalotCloudSettingsProps {
	onProviderConfigured: () => void;
}

const MOCK_TOPUP_PACKAGES = [
	{
		id: "credits-10",
		label: "CNY 10",
		amountMicros: "10000000",
		creditMicros: "10000000",
		currency: "CNY" as const,
	},
	{
		id: "credits-30",
		label: "CNY 30",
		amountMicros: "30000000",
		creditMicros: "30000000",
		currency: "CNY" as const,
	},
	{
		id: "credits-100",
		label: "CNY 100",
		amountMicros: "100000000",
		creditMicros: "100000000",
		currency: "CNY" as const,
	},
];

const MOCK_CONNECTED_STATUS: PalotCloudStatus = {
	available: true,
	connected: true,
	encryptionAvailable: true,
	gatewayHost: "cloud.palot.example",
	paymentChannel: "sandbox",
	paymentsAvailable: true,
	topupPackages: MOCK_TOPUP_PACKAGES,
	account: {
		id: "account-demo",
		name: "Palot Cloud Demo",
		state: "active",
		balanceMicros: "28760000",
		currency: "CNY",
		recentTopups: [],
		recentUsage: [
			{
				id: "usage-demo",
				model: "Palot DeepSeek",
				priceVersion: 1,
				state: "settled",
				reservedMicros: "120000",
				chargedMicros: "84000",
				usage: {
					inputTokens: 12_400,
					outputTokens: 2_100,
					cacheReadTokens: 0,
					source: "provider",
				},
				createdAt: "2026-08-09T08:00:00.000Z",
				settledAt: "2026-08-09T08:00:12.000Z",
			},
		],
	},
	models: [
		{
			id: "palot-deepseek-chat",
			name: "Palot DeepSeek",
			pricing: {
				currency: "CNY",
				unit: "million_tokens",
				inputMicros: "1300000",
				outputMicros: "5200000",
				cacheReadMicros: "130000",
				version: 1,
			},
		},
		{
			id: "palot-glm-coding",
			name: "Palot GLM Coding",
			pricing: {
				currency: "CNY",
				unit: "million_tokens",
				inputMicros: "650000",
				outputMicros: "2600000",
				cacheReadMicros: "65000",
				version: 1,
			},
		},
	],
	error: null,
};

const MOCK_DISCONNECTED_STATUS: PalotCloudStatus = {
	...MOCK_CONNECTED_STATUS,
	connected: false,
	account: null,
	models: [],
	paymentChannel: null,
	paymentsAvailable: false,
	topupPackages: [],
};

const TERMINAL_TOPUP_STATES = new Set<PalotCloudTopupOrder["state"]>([
	"credited",
	"closed",
	"refunded",
	"failed",
]);

function formatMicros(value: string): string {
	const micros = BigInt(value);
	const cents = (micros + 5_000n) / 10_000n;
	return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

function errorMessage(error: unknown, fallback: string): string {
	return error instanceof Error ? error.message : fallback;
}

function createMockOrder(packageId: string): PalotCloudTopupOrder {
	const topupPackage = MOCK_TOPUP_PACKAGES.find(
		(item) => item.id === packageId,
	)!;
	const now = new Date();
	return {
		id: crypto.randomUUID(),
		packageId,
		channel: "sandbox",
		state: "pending",
		amountMicros: topupPackage.amountMicros,
		creditMicros: topupPackage.creditMicros,
		currency: "CNY",
		createdAt: now.toISOString(),
		expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
		paidAt: null,
		creditedAt: null,
		refundedAt: null,
	};
}

function findOpenTopup(status: PalotCloudStatus): PalotCloudTopupOrder | null {
	return (
		status.account?.recentTopups.find(
			(order) => order.state === "pending" || order.state === "paid",
		) ?? null
	);
}

export function PalotCloudSettings({
	onProviderConfigured,
}: PalotCloudSettingsProps) {
	const { t } = useTranslation("settings");
	const isMockMode = useAtomValue(isMockModeAtom);
	const [status, setStatus] = useState<PalotCloudStatus | null>(null);
	const [token, setToken] = useState("");
	const [loading, setLoading] = useState(true);
	const [action, setAction] = useState<
		"connect" | "disconnect" | "refresh" | "topup" | null
	>(null);
	const [topupPackageId, setTopupPackageId] = useState<string | null>(null);
	const [pendingOrder, setPendingOrder] = useState<PalotCloudTopupOrder | null>(
		null,
	);
	const [error, setError] = useState<string | null>(null);
	const applyStatus = useCallback((nextStatus: PalotCloudStatus) => {
		setStatus(nextStatus);
		setPendingOrder((current) => current ?? findOpenTopup(nextStatus));
	}, []);

	const refresh = useCallback(async () => {
		if (isMockMode) {
			setStatus((current) =>
				current?.connected === false
					? MOCK_DISCONNECTED_STATUS
					: MOCK_CONNECTED_STATUS,
			);
			setLoading(false);
			return;
		}
		if (!window.palot?.palotCloud) return;
		setAction("refresh");
		setError(null);
		try {
			applyStatus(await window.palot.palotCloud.status());
		} catch (requestError) {
			setError(errorMessage(requestError, t("cloud.requestFailed")));
		} finally {
			setLoading(false);
			setAction(null);
		}
	}, [applyStatus, isMockMode, t]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	const pendingOrderId = pendingOrder?.id ?? null;
	const pendingOrderState = pendingOrder?.state ?? null;
	useEffect(() => {
		if (
			!pendingOrderId ||
			!pendingOrderState ||
			TERMINAL_TOPUP_STATES.has(pendingOrderState)
		)
			return;
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | null = null;

		const poll = async () => {
			try {
				if (isMockMode) {
					const paidAt = new Date().toISOString();
					startTransition(() => {
						setPendingOrder((current) =>
							current
								? { ...current, state: "credited", paidAt, creditedAt: paidAt }
								: null,
						);
						setStatus((current) =>
							current?.account
								? {
										...current,
										account: {
											...current.account,
											balanceMicros: (
												BigInt(current.account.balanceMicros) +
												BigInt(pendingOrder?.creditMicros ?? "0")
											).toString(),
										},
									}
								: current,
						);
					});
					return;
				}
				if (!window.palot?.palotCloud) return;
				const nextOrder =
					await window.palot.palotCloud.topupOrder(pendingOrderId);
				if (cancelled) return;
				startTransition(() => setPendingOrder(nextOrder));
				if (nextOrder.state === "credited") {
					const nextStatus = await window.palot.palotCloud.status();
					if (!cancelled) startTransition(() => setStatus(nextStatus));
					return;
				}
				if (!TERMINAL_TOPUP_STATES.has(nextOrder.state))
					timer = setTimeout(poll, 2_000);
			} catch (requestError) {
				if (!cancelled)
					setError(errorMessage(requestError, t("cloud.requestFailed")));
			}
		};

		timer = setTimeout(poll, isMockMode ? 800 : 2_000);
		return () => {
			cancelled = true;
			if (timer) clearTimeout(timer);
		};
	}, [
		isMockMode,
		pendingOrderId,
		pendingOrderState,
		pendingOrder?.creditMicros,
		t,
	]);

	const connect = useCallback(async () => {
		if (isMockMode && token.trim()) {
			setStatus(MOCK_CONNECTED_STATUS);
			setToken("");
			onProviderConfigured();
			return;
		}
		if (!window.palot?.palotCloud || !token.trim()) return;
		setAction("connect");
		setError(null);
		try {
			const result = await window.palot.palotCloud.connect(token.trim());
			if (!result.setup) throw new Error(t("cloud.setupMissing"));
			await applyPalotCloudProvider(result.setup);
			applyStatus(result.status);
			setToken("");
			onProviderConfigured();
		} catch (requestError) {
			setError(errorMessage(requestError, t("cloud.requestFailed")));
		} finally {
			setAction(null);
		}
	}, [applyStatus, isMockMode, token, onProviderConfigured, t]);

	const disconnect = useCallback(async () => {
		if (isMockMode) {
			setStatus(MOCK_DISCONNECTED_STATUS);
			setPendingOrder(null);
			onProviderConfigured();
			return;
		}
		if (!window.palot?.palotCloud) return;
		setAction("disconnect");
		setError(null);
		try {
			const nextStatus = await window.palot.palotCloud.disconnect();
			await disablePalotCloudProvider();
			setStatus(nextStatus);
			setPendingOrder(null);
			onProviderConfigured();
		} catch (requestError) {
			setError(errorMessage(requestError, t("cloud.requestFailed")));
		} finally {
			setAction(null);
		}
	}, [isMockMode, onProviderConfigured, t]);

	const startTopup = useCallback(
		async (packageId: string) => {
			setAction("topup");
			setTopupPackageId(packageId);
			setError(null);
			try {
				const order = isMockMode
					? createMockOrder(packageId)
					: await window.palot!.palotCloud.startTopup(packageId);
				setPendingOrder(order);
			} catch (requestError) {
				setError(errorMessage(requestError, t("cloud.requestFailed")));
			} finally {
				setAction(null);
				setTopupPackageId(null);
			}
		},
		[isMockMode, t],
	);

	if (loading || !status) return null;
	if (!status.available && !status.connected) return null;

	return (
		<section className="space-y-3">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h3 className="flex items-center gap-2 text-base font-semibold">
						<CloudIcon className="size-4" aria-hidden="true" />
						Palot Cloud
						<span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
							Beta
						</span>
					</h3>
					<p className="mt-1 text-sm text-muted-foreground">
						{t("cloud.description")}
					</p>
				</div>
				{status.connected ? (
					<div className="flex gap-2">
						<Button
							variant="outline"
							size="icon"
							onClick={refresh}
							disabled={action !== null}
							title={t("cloud.refresh")}
						>
							{action === "refresh" ? (
								<Spinner className="size-4" />
							) : (
								<RefreshCwIcon className="size-4" aria-hidden="true" />
							)}
							<span className="sr-only">{t("cloud.refresh")}</span>
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={disconnect}
							disabled={action !== null}
						>
							<UnplugIcon className="size-4" aria-hidden="true" />
							{t("cloud.disconnect")}
						</Button>
					</div>
				) : null}
			</div>

			<div className="divide-y rounded-md border">
				{status.connected && status.account ? (
					<>
						<div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
							<div>
								<p className="text-xs text-muted-foreground">
									{t("cloud.balance")}
								</p>
								<p className="text-lg font-semibold">
									CNY {formatMicros(status.account.balanceMicros)}
								</p>
							</div>
							{status.paymentsAvailable ? (
								<div className="flex flex-wrap gap-2">
									{status.topupPackages.map((topupPackage) => (
										<Button
											key={topupPackage.id}
											variant="outline"
											size="sm"
											onClick={() => startTopup(topupPackage.id)}
											disabled={action !== null}
										>
											{action === "topup" &&
											topupPackageId === topupPackage.id ? (
												<Spinner className="size-4" />
											) : (
												<WalletCardsIcon
													className="size-4"
													aria-hidden="true"
												/>
											)}
											{topupPackage.label}
										</Button>
									))}
								</div>
							) : null}
						</div>
						{pendingOrder ? (
							<div className="flex items-center justify-between gap-3 px-4 py-2.5">
								<span className="truncate text-xs text-muted-foreground">
									{t("cloud.topup", { channel: pendingOrder.channel })}
								</span>
								<span className="shrink-0 text-xs font-medium capitalize">
									{t(`cloud.orderStates.${pendingOrder.state}`)} · CNY{" "}
									{formatMicros(pendingOrder.amountMicros)}
								</span>
							</div>
						) : null}
						{status.account.recentTopups
							.filter((topup) => topup.id !== pendingOrder?.id)
							.slice(0, 3)
							.map((topup) => (
								<div
									key={topup.id}
									className="flex items-center justify-between gap-3 px-4 py-2.5"
								>
									<span className="truncate text-xs text-muted-foreground">
										{t("cloud.topup", { channel: topup.channel })}
									</span>
									<span className="shrink-0 text-xs capitalize">
										{t(`cloud.orderStates.${topup.state}`)} · CNY{" "}
										{formatMicros(topup.amountMicros)}
									</span>
								</div>
							))}
						{status.models.map((model) => (
							<div
								key={model.id}
								className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
							>
								<span className="text-sm font-medium">{model.name}</span>
								<span className="text-xs text-muted-foreground">
									{t("cloud.pricing", {
										input: formatMicros(model.pricing.inputMicros),
										output: formatMicros(model.pricing.outputMicros),
									})}
								</span>
							</div>
						))}
						{status.account.recentUsage.slice(0, 5).map((usage) => (
							<div
								key={usage.id}
								className="flex items-center justify-between gap-3 px-4 py-2.5"
							>
								<span className="truncate text-xs text-muted-foreground">
									{usage.model}
								</span>
								<span className="shrink-0 text-xs">
									CNY {formatMicros(usage.chargedMicros)}
								</span>
							</div>
						))}
					</>
				) : (
					<div className="space-y-3 px-4 py-4">
						<div className="space-y-2">
							<Label htmlFor="palot-cloud-token">
								{t("cloud.accessToken")}
							</Label>
							<Input
								id="palot-cloud-token"
								type="password"
								value={token}
								onChange={(event) => setToken(event.target.value)}
								placeholder="palot_live_..."
								disabled={action !== null || !status.encryptionAvailable}
							/>
						</div>
						<Button
							onClick={connect}
							disabled={!token.trim() || action !== null}
						>
							{action === "connect" ? <Spinner className="size-4" /> : null}
							{t("common:actions.connect")}
						</Button>
					</div>
				)}
			</div>

			{status.error || error ? (
				<p className="text-sm text-destructive">{error ?? status.error}</p>
			) : null}
			{!status.encryptionAvailable ? (
				<p className="text-sm text-destructive">
					{t("cloud.secureStorageUnavailable")}
				</p>
			) : null}
		</section>
	);
}
