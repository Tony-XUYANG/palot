/**
 * Auto-updater with a Windows China mirror and GitHub fallback.
 */

import { app, BrowserWindow, shell } from "electron"
import type { AppUpdater, UpdateCheckResult, UpdateInfo } from "electron-updater"
import {
	createUpdateSources,
	getEmbeddedUpdateConfiguration,
	getReleasePageUrl,
	GITHUB_UPDATE_SOURCE,
	runWithUpdateSourceFallback,
	type UpdateSource,
	type UpdateSourceId,
} from "./update-sources"

let autoUpdaterInstance: AppUpdater | null = null

async function getAutoUpdater(): Promise<AppUpdater> {
	if (!autoUpdaterInstance) {
		// electron-updater is CJS; this shape keeps the lazy import ESM-compatible.
		const electronUpdater = await import("electron-updater")
		autoUpdaterInstance = electronUpdater.default.autoUpdater
	}
	return autoUpdaterInstance
}

// ============================================================
// Signing detection
// ============================================================

function detectCanAutoInstall(): boolean {
	if (process.platform !== "darwin" || !app.isPackaged) return true

	try {
		const { execFileSync } = require("node:child_process")
		execFileSync("codesign", ["--verify", "--deep", "--strict", app.getPath("exe")], {
			encoding: "utf8",
			stdio: "pipe",
		})
		return true
	} catch {
		return false
	}
}

let canAutoInstall = true

// ============================================================
// Sources and state
// ============================================================

function resolveUpdateSources(): UpdateSource[] {
	try {
		return createUpdateSources(process.platform, getEmbeddedUpdateConfiguration())
	} catch (error) {
		const message = error instanceof Error ? error.message : "invalid configuration"
		console.error(`[auto-updater] China update configuration disabled: ${message}`)
		return [GITHUB_UPDATE_SOURCE]
	}
}

const updateSources = resolveUpdateSources()
let activeSource = updateSources[0] ?? GITHUB_UPDATE_SOURCE

export interface UpdateState {
	status: "idle" | "checking" | "available" | "downloading" | "ready" | "error"
	version?: string
	releaseNotes?: string
	progress?: {
		percent: number
		bytesPerSecond: number
		transferred: number
		total: number
	}
	error?: string
	/** Whether the app can auto-install updates (false on unsigned macOS builds). */
	canAutoInstall: boolean
	/** The source currently used for update metadata and downloads. */
	source: UpdateSourceId
	/** Whether GitHub was selected after the China mirror failed. */
	fallbackUsed: boolean
}

let state: UpdateState = {
	status: "idle",
	canAutoInstall: true,
	source: activeSource.id,
	fallbackUsed: false,
}
let checkInterval: ReturnType<typeof setInterval> | null = null
let checkOperation: Promise<UpdateCheckResult | null> | null = null
let downloadOperation: Promise<void> | null = null
let managedOperationCount = 0

function getMainWindow(): BrowserWindow | null {
	return BrowserWindow.getAllWindows()[0] ?? null
}

function setState(next: Partial<UpdateState>): void {
	state = { ...state, ...next }
	getMainWindow()?.webContents.send("updater:state-changed", state)
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "Update operation failed"
}

async function setActiveSource(
	autoUpdater: AppUpdater,
	source: UpdateSource,
	fallbackUsed: boolean,
): Promise<void> {
	activeSource = source
	autoUpdater.setFeedURL(source.feed)
	setState({
		source: source.id,
		fallbackUsed,
		error: undefined,
		progress: undefined,
	})
}

async function performCheck(
	autoUpdater: AppUpdater,
	sources: UpdateSource[],
	fallbackAlreadyUsed = false,
): Promise<UpdateCheckResult | null> {
	const result = await runWithUpdateSourceFallback(
		sources,
		async (source, attemptUsedFallback) => {
			const fallbackUsed = fallbackAlreadyUsed || attemptUsedFallback
			await setActiveSource(autoUpdater, source, fallbackUsed)
			return await autoUpdater.checkForUpdates()
		},
	)

	return result.value
}

async function runManagedOperation<T>(operation: () => Promise<T>): Promise<T> {
	managedOperationCount++
	try {
		return await operation()
	} finally {
		managedOperationCount--
	}
}

async function performDownload(autoUpdater: AppUpdater): Promise<void> {
	try {
		await autoUpdater.downloadUpdate()
		return
	} catch (primaryError) {
		const sourceIndex = updateSources.findIndex((source) => source.id === activeSource.id)
		const fallbackSources = sourceIndex >= 0 ? updateSources.slice(sourceIndex + 1) : []
		if (fallbackSources.length === 0) throw primaryError

		console.warn(
			`[auto-updater] Download from ${activeSource.id} failed; retrying with fallback`,
		)
		const result = await performCheck(autoUpdater, fallbackSources, true)
		if (!result?.isUpdateAvailable) {
			throw new Error("The fallback update source does not contain the requested update")
		}
		await autoUpdater.downloadUpdate()
	}
}

function setFinalError(error: unknown): void {
	const message = getErrorMessage(error)
	console.error(`[auto-updater] Operation failed: ${message}`)
	setState({ status: "error", error: message, progress: undefined })
}

// ============================================================
// Public API
// ============================================================

export async function initAutoUpdater(): Promise<void> {
	if (!app.isPackaged) return

	canAutoInstall = detectCanAutoInstall()
	state = { ...state, canAutoInstall }

	console.log(
		`[auto-updater] platform=${process.platform}, source=${activeSource.id}, canAutoInstall=${canAutoInstall}`,
	)

	const autoUpdater = await getAutoUpdater()
	autoUpdater.logger = console
	autoUpdater.autoDownload = false
	autoUpdater.autoInstallOnAppQuit = canAutoInstall
	await setActiveSource(autoUpdater, activeSource, false)

	autoUpdater.on("checking-for-update", () => {
		setState({ status: "checking", error: undefined })
	})

	autoUpdater.on("update-available", (info: UpdateInfo) => {
		setState({
			status: "available",
			version: info.version,
			releaseNotes:
				typeof info.releaseNotes === "string"
					? info.releaseNotes
					: Array.isArray(info.releaseNotes)
						? info.releaseNotes.map((note) => note.note).join("\n")
						: undefined,
		})
	})

	autoUpdater.on("update-not-available", () => {
		setState({ status: "idle", version: undefined, releaseNotes: undefined })
	})

	autoUpdater.on("download-progress", (progress) => {
		setState({
			status: "downloading",
			progress: {
				percent: progress.percent,
				bytesPerSecond: progress.bytesPerSecond,
				transferred: progress.transferred,
				total: progress.total,
			},
		})
	})

	autoUpdater.on("update-downloaded", () => {
		setState({ status: "ready", progress: undefined })
	})

	autoUpdater.on("error", (error) => {
		if (managedOperationCount > 0) {
			console.warn(`[auto-updater] Source attempt failed: ${getErrorMessage(error)}`)
			return
		}
		setFinalError(error)
	})

	setTimeout(() => {
		void checkForUpdates().catch(() => {})
	}, 10_000)

	checkInterval = setInterval(
		() => {
			void checkForUpdates().catch(() => {})
		},
		4 * 60 * 60 * 1000,
	)
}

export function getUpdateState(): UpdateState {
	return state
}

export async function checkForUpdates(): Promise<void> {
	if (!app.isPackaged) return
	if (checkOperation) {
		await checkOperation
		return
	}

	const autoUpdater = await getAutoUpdater()
	checkOperation = runManagedOperation(async () => {
		try {
			return await performCheck(autoUpdater, updateSources)
		} catch (error) {
			setFinalError(error)
			throw error
		}
	})

	try {
		await checkOperation
	} finally {
		checkOperation = null
	}
}

export async function downloadUpdate(): Promise<void> {
	if (downloadOperation) return await downloadOperation

	const autoUpdater = await getAutoUpdater()
	downloadOperation = runManagedOperation(async () => {
		try {
			await performDownload(autoUpdater)
		} catch (error) {
			setFinalError(error)
			throw error
		}
	})

	try {
		await downloadOperation
	} finally {
		downloadOperation = null
	}
}

export async function installUpdate(): Promise<void> {
	if (!canAutoInstall) {
		await openReleasePage()
		return
	}
	const autoUpdater = await getAutoUpdater()
	autoUpdater.quitAndInstall(true, true)
}

export async function openReleasePage(): Promise<void> {
	await shell.openExternal(getReleasePageUrl(activeSource, state.version))
}

export function stopAutoUpdater(): void {
	if (checkInterval) {
		clearInterval(checkInterval)
		checkInterval = null
	}
}
