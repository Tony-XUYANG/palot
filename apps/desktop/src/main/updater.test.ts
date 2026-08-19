import { describe, expect, it, mock } from "bun:test";

const quitAndInstall = mock(() => {});

mock.module("electron", () => ({
	app: {
		isPackaged: true,
		getPath: () => "C:\\Palot\\Palot.exe",
	},
	BrowserWindow: {
		getAllWindows: () => [],
	},
	shell: {
		openExternal: async () => {},
	},
}));

mock.module("electron-updater", () => ({
	default: {
		autoUpdater: {
			quitAndInstall,
		},
	},
}));

describe("auto updater", () => {
	it("installs Windows updates silently and restarts Palot", async () => {
		const { installUpdate } = await import("./updater");
		await installUpdate();
		expect(quitAndInstall).toHaveBeenCalledWith(true, true);
	});
});
