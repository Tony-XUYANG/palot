/**
 * Pure time formatting utilities for compact relative timestamps.
 *
 * Used by the automations inbox for "1h", "2h", "3d" style timestamps
 * and "Starts in 32m" style countdowns.
 */

import type { SupportedLocale } from "../../shared/i18n";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * Format a past timestamp as a compact relative string.
 * Examples: "1m", "5m", "1h", "3h", "2d", "1w", "3mo", "1y"
 */
export function formatTimeAgo(
	timestamp: number,
	locale: SupportedLocale = "en-US",
): string {
	const now = Date.now();
	const diff = now - timestamp;
	const relative = new Intl.RelativeTimeFormat(locale, {
		numeric: "auto",
		style: "narrow",
	});
	if (diff < 0) return relative.format(0, "second");

	if (diff < MINUTE) return relative.format(0, "second");
	if (diff < HOUR) return relative.format(-Math.floor(diff / MINUTE), "minute");
	if (diff < DAY) return relative.format(-Math.floor(diff / HOUR), "hour");
	if (diff < WEEK) return relative.format(-Math.floor(diff / DAY), "day");
	if (diff < MONTH) return relative.format(-Math.floor(diff / WEEK), "week");
	if (diff < YEAR) return relative.format(-Math.floor(diff / MONTH), "month");
	return relative.format(-Math.floor(diff / YEAR), "year");
}

/**
 * Format a future timestamp as a compact countdown string.
 * Examples: "now", "32m", "1h", "2d", "1w"
 */
export function formatCountdown(
	futureTimestamp: number,
	locale: SupportedLocale = "en-US",
): string {
	const now = Date.now();
	const diff = futureTimestamp - now;
	const number = (value: number, unit: string) =>
		locale === "zh-CN" ? `${value} ${unit}` : `${value}${unit}`;
	if (diff <= 0) return locale === "zh-CN" ? "现在" : "now";

	if (diff < HOUR)
		return number(Math.max(1, Math.ceil(diff / MINUTE)), locale === "zh-CN" ? "分钟" : "m");
	if (diff < DAY)
		return number(Math.floor(diff / HOUR), locale === "zh-CN" ? "小时" : "h");
	if (diff < WEEK)
		return number(Math.floor(diff / DAY), locale === "zh-CN" ? "天" : "d");
	if (diff < MONTH)
		return number(Math.floor(diff / WEEK), locale === "zh-CN" ? "周" : "w");
	if (diff < YEAR)
		return number(Math.floor(diff / MONTH), locale === "zh-CN" ? "个月" : "mo");
	return number(Math.floor(diff / YEAR), locale === "zh-CN" ? "年" : "y");
}

/**
 * Format a duration in milliseconds as a human-readable string.
 * Examples: "5s", "1m 23s", "1h 5m"
 */
export function formatDuration(ms: number): string {
	if (ms < 1000) return "<1s";
	const totalSeconds = Math.floor(ms / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m ${seconds}s`;
	return `${seconds}s`;
}
