/**
 * Restores the process-local Palot Cloud provider whenever OpenCode reconnects.
 */

import { useAtomValue } from "jotai";
import { useEffect } from "react";
import { serverConnectedAtom } from "../atoms/connection";
import { createLogger } from "../lib/logger";
import {
	applyPalotCloudProvider,
	disablePalotCloudProvider,
} from "../lib/palot-cloud";

const log = createLogger("palot-cloud");
const RETRY_DELAY_MS = 30_000;

export function usePalotCloudBootstrap(): void {
	const serverConnected = useAtomValue(serverConnectedAtom);

	useEffect(() => {
		if (!serverConnected || !window.palot?.palotCloud) return;
		let cancelled = false;
		let retryTimer: ReturnType<typeof setTimeout> | null = null;

		const bootstrap = async () => {
			try {
				const result = await window.palot.palotCloud.bootstrap();
				if (cancelled) return;
				if (result.setup) {
					await applyPalotCloudProvider(result.setup);
					return;
				}
				await disablePalotCloudProvider();
				if (result.status.connected) {
					retryTimer = setTimeout(bootstrap, RETRY_DELAY_MS);
				}
			} catch (error) {
				log.warn("Palot Cloud bootstrap failed", {
					error: error instanceof Error ? error.message : "Unknown error",
				});
				if (!cancelled) retryTimer = setTimeout(bootstrap, RETRY_DELAY_MS);
			}
		};

		bootstrap();
		return () => {
			cancelled = true;
			if (retryTimer) clearTimeout(retryTimer);
		};
	}, [serverConnected]);
}
