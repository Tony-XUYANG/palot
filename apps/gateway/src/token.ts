/**
 * Opaque Palot access-token generation and one-way hashing.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

const TOKEN_PREFIX = "palot_live"
const TOKEN_PATTERN = /^palot_live_([a-f0-9]{12})_([A-Za-z0-9_-]{43})$/

export interface GeneratedAccessToken {
	raw: string
	prefix: string
	hash: string
}

export function hashAccessToken(raw: string, pepper: string): string {
	return createHmac("sha256", pepper).update(raw).digest("hex")
}

export function parseAccessTokenPrefix(raw: string): string | null {
	return raw.match(TOKEN_PATTERN)?.[1] ?? null
}

export function generateAccessToken(pepper: string): GeneratedAccessToken {
	const prefix = randomBytes(6).toString("hex")
	const secret = randomBytes(32).toString("base64url")
	const raw = `${TOKEN_PREFIX}_${prefix}_${secret}`
	return { raw, prefix, hash: hashAccessToken(raw, pepper) }
}

export function accessTokenHashMatches(raw: string, expectedHash: string, pepper: string): boolean {
	const actual = Buffer.from(hashAccessToken(raw, pepper), "hex")
	const expected = Buffer.from(expectedHash, "hex")
	return actual.length === expected.length && timingSafeEqual(actual, expected)
}
