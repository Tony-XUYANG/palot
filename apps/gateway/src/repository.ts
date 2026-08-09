/**
 * Persistence contract for accounts, pricing, reservations, and append-only billing state.
 */

import type { ModelPrice, TokenUsage } from "./pricing"

export type AccountState = "active" | "frozen"
export type UsageState = "reserved" | "settled" | "refunded"

export interface GatewayAccount {
	id: string
	name: string
	state: AccountState
	balanceMicros: bigint
}

export interface UsageRecord {
	id: string
	accountId: string
	idempotencyKey: string
	modelId: string
	priceVersion: number
	state: UsageState
	reservedMicros: bigint
	chargedMicros: bigint
	usage: TokenUsage | null
	createdAt: string
	settledAt: string | null
}

export interface AccountSummary extends GatewayAccount {
	recentUsage: UsageRecord[]
}

export interface ReservationResult {
	created: boolean
	usage: UsageRecord
	balanceMicros: bigint
}

export interface SettlementResult {
	usage: UsageRecord
	balanceMicros: bigint
}

export interface CreateTokenResult {
	rawToken: string
	tokenPrefix: string
}

export interface GatewayRepository {
	health(): Promise<boolean>
	authenticate(rawToken: string): Promise<GatewayAccount | null>
	getAccountSummary(accountId: string): Promise<AccountSummary | null>
	listActivePrices(): Promise<ModelPrice[]>
	getActivePrice(modelId: string): Promise<ModelPrice | null>
	reserve(input: {
		accountId: string
		idempotencyKey: string
		modelId: string
		priceVersion: number
		reservedMicros: bigint
	}): Promise<ReservationResult>
	settle(input: {
		usageId: string
		chargedMicros: bigint
		usage: TokenUsage
	}): Promise<SettlementResult>
	refund(usageId: string, reason: string): Promise<SettlementResult>
	createAccount(name: string): Promise<GatewayAccount>
	createToken(accountId: string): Promise<CreateTokenResult>
	revokeToken(tokenPrefix: string): Promise<boolean>
	grantCredit(input: {
		accountId: string
		amountMicros: bigint
		idempotencyKey: string
		reason: string
	}): Promise<GatewayAccount>
	setAccountState(accountId: string, state: AccountState): Promise<GatewayAccount>
	setPrice(input: Omit<ModelPrice, "version">): Promise<ModelPrice>
}

export class InsufficientBalanceError extends Error {}
export class AccountUnavailableError extends Error {}
export class DuplicateRequestError extends Error {}
export class RepositoryNotFoundError extends Error {}
