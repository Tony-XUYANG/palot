import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it } from "node:test"
import {
	PalotCloudTokenStore,
	type PalotCloudEncryptionAdapter,
} from "./palot-cloud-token-store.ts"

function createEncryption(available = true): PalotCloudEncryptionAdapter {
	return {
		isEncryptionAvailable: () => available,
		encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
		decryptString: (value) => value.toString("utf8").replace(/^encrypted:/, ""),
	}
}

describe("Palot Cloud token storage", () => {
	it("stores only encrypted bytes and round-trips through the OS adapter", async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), "palot-cloud-token-"))
		try {
			const filePath = path.join(directory, "credentials.json")
			const store = new PalotCloudTokenStore(filePath, createEncryption())
			const token = "palot_live_0123456789ab_abcdefghijklmnopqrstuvwxyzABCDEFGH123456789"
			await store.store(token)
			assert.equal(await store.read(), token)
			assert.doesNotMatch(await readFile(filePath, "utf8"), new RegExp(token))
			await store.delete()
			assert.equal(await store.read(), null)
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	})

	it("refuses to store or decrypt without OS encryption", async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), "palot-cloud-token-"))
		try {
			const filePath = path.join(directory, "credentials.json")
			const secureStore = new PalotCloudTokenStore(filePath, createEncryption())
			await secureStore.store("secret")
			const unavailableStore = new PalotCloudTokenStore(filePath, createEncryption(false))
			await assert.rejects(unavailableStore.store("secret"), /unavailable/)
			await assert.rejects(unavailableStore.read(), /unavailable/)
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	})
})
