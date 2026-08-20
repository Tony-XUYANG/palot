/**
 * Hook that returns a live-updating countdown string for a future timestamp.
 *
 * Re-renders every 60 seconds (or every second when under a minute)
 * so the "Next in 32m" text stays fresh without relying on parent polls.
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatCountdown } from "../lib/time-format";

export function useCountdown(futureTimestamp: number | null): string | null {
	const { i18n } = useTranslation();
	const locale = i18n.language === "zh-CN" ? "zh-CN" : "en-US";
	const [label, setLabel] = useState(() =>
		futureTimestamp ? formatCountdown(futureTimestamp, locale) : null,
	);

	useEffect(() => {
		if (!futureTimestamp) {
			setLabel(null);
			return;
		}

		// Compute immediately
		setLabel(formatCountdown(futureTimestamp, locale));

		function tick() {
			setLabel(formatCountdown(futureTimestamp!, locale));
		}

		// Tick every 30s for general countdowns, every 5s when under 2 minutes
		function getInterval(): number {
			const diff = futureTimestamp! - Date.now();
			if (diff <= 0) return 5_000;
			if (diff < 120_000) return 5_000;
			return 30_000;
		}

		let timerId: ReturnType<typeof setTimeout>;

		function schedule() {
			timerId = setTimeout(() => {
				tick();
				schedule();
			}, getInterval());
		}

		schedule();

		return () => clearTimeout(timerId);
	}, [futureTimestamp, locale]);

	return label;
}
