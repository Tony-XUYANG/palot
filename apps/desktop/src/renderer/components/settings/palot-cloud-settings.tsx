/**
 * Palot Cloud prepaid balance and connection controls.
 */

import { Button } from "@palot/ui/components/button"
import { Input } from "@palot/ui/components/input"
import { Label } from "@palot/ui/components/label"
import { Spinner } from "@palot/ui/components/spinner"
import { useAtomValue } from "jotai"
import { CloudIcon, RefreshCwIcon, UnplugIcon } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import type { PalotCloudStatus } from "../../../preload/api"
import { isMockModeAtom } from "../../atoms/mock-mode"
import { applyPalotCloudProvider, disablePalotCloudProvider } from "../../lib/palot-cloud"

interface PalotCloudSettingsProps {
	onProviderConfigured: () => void
}

const MOCK_CONNECTED_STATUS: PalotCloudStatus = {
	available: true,
	connected: true,
	encryptionAvailable: true,
	gatewayHost: "cloud.palot.example",
	account: {
		id: "account-demo",
		name: "Palot Cloud Demo",
		state: "active",
		balanceMicros: "28760000",
		currency: "CNY",
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
}

const MOCK_DISCONNECTED_STATUS: PalotCloudStatus = {
	...MOCK_CONNECTED_STATUS,
	connected: false,
	account: null,
	models: [],
}

function formatMicros(value: string): string {
	const micros = BigInt(value)
	const cents = (micros + 5_000n) / 10_000n
	return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "Palot Cloud request failed"
}

export function PalotCloudSettings({ onProviderConfigured }: PalotCloudSettingsProps) {
	const isMockMode = useAtomValue(isMockModeAtom)
	const [status, setStatus] = useState<PalotCloudStatus | null>(null)
	const [token, setToken] = useState("")
	const [loading, setLoading] = useState(true)
	const [action, setAction] = useState<"connect" | "disconnect" | "refresh" | null>(null)
	const [error, setError] = useState<string | null>(null)

	const refresh = useCallback(async () => {
		if (isMockMode) {
			setStatus((current) =>
				current?.connected === false ? MOCK_DISCONNECTED_STATUS : MOCK_CONNECTED_STATUS,
			)
			setLoading(false)
			return
		}
		if (!window.palot?.palotCloud) return
		setAction("refresh")
		setError(null)
		try {
			setStatus(await window.palot.palotCloud.status())
		} catch (requestError) {
			setError(errorMessage(requestError))
		} finally {
			setLoading(false)
			setAction(null)
		}
	}, [isMockMode])

	useEffect(() => {
		refresh()
	}, [refresh])

	const connect = useCallback(async () => {
		if (isMockMode && token.trim()) {
			setStatus(MOCK_CONNECTED_STATUS)
			setToken("")
			onProviderConfigured()
			return
		}
		if (!window.palot?.palotCloud || !token.trim()) return
		setAction("connect")
		setError(null)
		try {
			const result = await window.palot.palotCloud.connect(token.trim())
			if (!result.setup) throw new Error("Palot Cloud did not return a provider setup")
			await applyPalotCloudProvider(result.setup)
			setStatus(result.status)
			setToken("")
			onProviderConfigured()
		} catch (requestError) {
			setError(errorMessage(requestError))
		} finally {
			setAction(null)
		}
	}, [isMockMode, token, onProviderConfigured])

	const disconnect = useCallback(async () => {
		if (isMockMode) {
			setStatus(MOCK_DISCONNECTED_STATUS)
			onProviderConfigured()
			return
		}
		if (!window.palot?.palotCloud) return
		setAction("disconnect")
		setError(null)
		try {
			const nextStatus = await window.palot.palotCloud.disconnect()
			await disablePalotCloudProvider()
			setStatus(nextStatus)
			onProviderConfigured()
		} catch (requestError) {
			setError(errorMessage(requestError))
		} finally {
			setAction(null)
		}
	}, [isMockMode, onProviderConfigured])

	if (loading || !status) return null
	if (!status.available && !status.connected) return null

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
						Prepaid DeepSeek and GLM usage. BYOK providers remain available.
					</p>
				</div>
				{status.connected ? (
					<div className="flex gap-2">
						<Button variant="outline" size="icon" onClick={refresh} disabled={action !== null}>
							{action === "refresh" ? (
								<Spinner className="size-4" />
							) : (
								<RefreshCwIcon className="size-4" aria-hidden="true" />
							)}
							<span className="sr-only">Refresh Palot Cloud</span>
						</Button>
						<Button variant="outline" size="sm" onClick={disconnect} disabled={action !== null}>
							<UnplugIcon className="size-4" aria-hidden="true" />
							Disconnect
						</Button>
					</div>
				) : null}
			</div>

			<div className="divide-y rounded-md border">
				{status.connected && status.account ? (
					<>
						<div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
							<div>
								<p className="text-xs text-muted-foreground">Available balance</p>
								<p className="text-lg font-semibold">¥{formatMicros(status.account.balanceMicros)}</p>
							</div>
							<p className="text-xs text-muted-foreground">Manual packs: ¥10 / ¥30 / ¥100</p>
						</div>
						{status.models.map((model) => (
							<div key={model.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
								<span className="text-sm font-medium">{model.name}</span>
								<span className="text-xs text-muted-foreground">
									Input ¥{formatMicros(model.pricing.inputMicros)} / Output ¥
									{formatMicros(model.pricing.outputMicros)} per 1M tokens
								</span>
							</div>
						))}
						{status.account.recentUsage.slice(0, 5).map((usage) => (
							<div key={usage.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
								<span className="truncate text-xs text-muted-foreground">{usage.model}</span>
								<span className="shrink-0 text-xs">¥{formatMicros(usage.chargedMicros)}</span>
							</div>
						))}
					</>
				) : (
					<div className="space-y-3 px-4 py-4">
						<div className="space-y-2">
							<Label htmlFor="palot-cloud-token">Access token</Label>
							<Input
								id="palot-cloud-token"
								type="password"
								value={token}
								onChange={(event) => setToken(event.target.value)}
								placeholder="palot_live_..."
								disabled={action !== null || !status.encryptionAvailable}
							/>
						</div>
						<Button onClick={connect} disabled={!token.trim() || action !== null}>
							{action === "connect" ? <Spinner className="size-4" /> : null}
							Connect
						</Button>
					</div>
				)}
			</div>

			{status.error || error ? (
				<p className="text-sm text-destructive">{error ?? status.error}</p>
			) : null}
			{!status.encryptionAvailable ? (
				<p className="text-sm text-destructive">Secure OS credential storage is unavailable.</p>
			) : null}
		</section>
	)
}
