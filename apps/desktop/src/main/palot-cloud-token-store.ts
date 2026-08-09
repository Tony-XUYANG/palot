/**
 * Strict encrypted storage for the long-lived Palot Cloud access token.
 */

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"

interface StoredPalotCloudToken {
	schemaVersion: 1
	encryptedToken: string
	connectedAt: string
}

export interface PalotCloudEncryptionAdapter {
	isEncryptionAvailable(): boolean
	encryptString(value: string): Buffer
	decryptString(value: Buffer): string
}

export class PalotCloudTokenStore {
	constructor(
		private readonly filePath: string,
		private readonly encryption: PalotCloudEncryptionAdapter,
	) {}

	isEncryptionAvailable(): boolean {
		return this.encryption.isEncryptionAvailable()
	}

	async hasToken(): Promise<boolean> {
		return (await this.read()) !== null
	}

	async store(rawToken: string): Promise<void> {
		if (!this.encryption.isEncryptionAvailable()) {
			throw new Error("Secure OS credential encryption is unavailable")
		}
		const value: StoredPalotCloudToken = {
			schemaVersion: 1,
			encryptedToken: this.encryption.encryptString(rawToken).toString("base64"),
			connectedAt: new Date().toISOString(),
		}
		await mkdir(path.dirname(this.filePath), { recursive: true })
		const temporaryPath = `${this.filePath}.${process.pid}.tmp`
		await writeFile(temporaryPath, JSON.stringify(value, null, "\t"), {
			encoding: "utf8",
			mode: 0o600,
		})
		await rename(temporaryPath, this.filePath)
	}

	async read(): Promise<string | null> {
		let text: string
		try {
			text = await readFile(this.filePath, "utf8")
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
			throw error
		}
		if (!this.encryption.isEncryptionAvailable()) {
			throw new Error("Secure OS credential encryption is unavailable")
		}
		const value = JSON.parse(text) as Partial<StoredPalotCloudToken>
		if (value.schemaVersion !== 1 || !value.encryptedToken) {
			throw new Error("Palot Cloud credential storage is invalid")
		}
		return this.encryption.decryptString(Buffer.from(value.encryptedToken, "base64"))
	}

	async delete(): Promise<void> {
		await rm(this.filePath, { force: true })
	}
}
