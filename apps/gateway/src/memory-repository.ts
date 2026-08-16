/**
 * Deterministic in-memory repository used by gateway unit and HTTP tests.
 */

import { randomUUID } from "node:crypto"
import type {
	CheckoutOrder,
	PaymentChannel,
	PaymentNotification,
	PaymentOrder,
	TopupPackage,
} from "./payments"
import type { ModelPrice, TokenUsage } from "./pricing"
import {
	type AccountState,
	type AccountSummary,
	AccountUnavailableError,
	type CreateTokenResult,
	type GatewayAccount,
	type GatewayRepository,
	InsufficientBalanceError,
	RepositoryNotFoundError,
	type ReservationResult,
	type SettlementResult,
	type UsageRecord,
} from "./repository"
import { accessTokenHashMatches, generateAccessToken, parseAccessTokenPrefix } from "./token"

interface StoredToken {
	accountId: string
	prefix: string
	hash: string
	revoked: boolean
}

export class MemoryGatewayRepository implements GatewayRepository {
	private readonly accounts = new Map<string, GatewayAccount>()
	private readonly tokens = new Map<string, StoredToken>()
	private readonly prices = new Map<string, ModelPrice>()
	private readonly usage = new Map<string, UsageRecord>()
	private readonly usageByIdempotency = new Map<string, string>()
	private readonly grantKeys = new Set<string>()
	private readonly topupPackages = new Map<string, TopupPackage>([
		[
			"credits-10",
			{
				id: "credits-10",
				label: "CNY 10",
				amountMicros: 10_000_000n,
				creditMicros: 10_000_000n,
				sortOrder: 10,
			},
		],
		[
			"credits-30",
			{
				id: "credits-30",
				label: "CNY 30",
				amountMicros: 30_000_000n,
				creditMicros: 30_000_000n,
				sortOrder: 20,
			},
		],
		[
			"credits-100",
			{
				id: "credits-100",
				label: "CNY 100",
				amountMicros: 100_000_000n,
				creditMicros: 100_000_000n,
				sortOrder: 30,
			},
		],
	])
	private readonly topupOrders = new Map<string, CheckoutOrder>()
	private readonly topupByIdempotency = new Map<string, string>()
	private readonly paymentEvents = new Set<string>()
	private mutationTail = Promise.resolve()

	constructor(
		private readonly tokenPepper: string,
		private readonly now: () => Date = () => new Date(),
	) {}

	async health(): Promise<boolean> {
		return true
	}

	async authenticate(rawToken: string): Promise<GatewayAccount | null> {
		const prefix = parseAccessTokenPrefix(rawToken)
		if (!prefix) return null
		const token = this.tokens.get(prefix)
		if (
			!token ||
			token.revoked ||
			!accessTokenHashMatches(rawToken, token.hash, this.tokenPepper)
		) {
			return null
		}
		return this.cloneAccount(this.accounts.get(token.accountId) ?? null)
	}

	async getAccountSummary(accountId: string): Promise<AccountSummary | null> {
		const account = this.accounts.get(accountId)
		if (!account) return null
		const recentUsage = [...this.usage.values()]
			.filter((item) => item.accountId === accountId)
			.toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))
			.slice(0, 20)
			.map((item) => structuredClone(item))
		const recentTopups = [...this.topupOrders.values()]
			.filter((item) => item.accountId === accountId)
			.toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))
			.slice(0, 10)
			.map((item) => this.publicOrder(item))
		return { ...account, recentUsage, recentTopups }
	}

	async listActivePrices(): Promise<ModelPrice[]> {
		return [...this.prices.values()].map((price) => ({ ...price }))
	}

	async getActivePrice(modelId: string): Promise<ModelPrice | null> {
		const price = this.prices.get(modelId)
		return price ? { ...price } : null
	}

	async reserve(input: {
		accountId: string
		idempotencyKey: string
		modelId: string
		priceVersion: number
		reservedMicros: bigint
	}): Promise<ReservationResult> {
		return await this.withMutation(() => {
			const existingId = this.usageByIdempotency.get(`${input.accountId}:${input.idempotencyKey}`)
			if (existingId) {
				const existing = this.usage.get(existingId)!
				return {
					created: false,
					usage: structuredClone(existing),
					balanceMicros: this.accounts.get(input.accountId)?.balanceMicros ?? 0n,
				}
			}
			const account = this.requireActiveAccount(input.accountId)
			if (input.reservedMicros <= 0n) throw new Error("Reservation must be greater than zero")
			if (account.balanceMicros < input.reservedMicros) {
				throw new InsufficientBalanceError("Insufficient Palot Cloud balance")
			}
			account.balanceMicros -= input.reservedMicros
			const now = this.now().toISOString()
			const usage: UsageRecord = {
				id: randomUUID(),
				accountId: input.accountId,
				idempotencyKey: input.idempotencyKey,
				modelId: input.modelId,
				priceVersion: input.priceVersion,
				state: "reserved",
				reservedMicros: input.reservedMicros,
				chargedMicros: 0n,
				usage: null,
				createdAt: now,
				settledAt: null,
			}
			this.usage.set(usage.id, usage)
			this.usageByIdempotency.set(`${input.accountId}:${input.idempotencyKey}`, usage.id)
			return { created: true, usage: structuredClone(usage), balanceMicros: account.balanceMicros }
		})
	}

	async settle(input: {
		usageId: string
		chargedMicros: bigint
		usage: TokenUsage
	}): Promise<SettlementResult> {
		return await this.withMutation(() => {
			if (input.chargedMicros < 0n) throw new Error("Charge cannot be negative")
			const record = this.requireUsage(input.usageId)
			const account = this.requireAccount(record.accountId)
			if (record.state !== "reserved") {
				return { usage: structuredClone(record), balanceMicros: account.balanceMicros }
			}
			const chargedMicros =
				input.chargedMicros > record.reservedMicros ? record.reservedMicros : input.chargedMicros
			const refundMicros = record.reservedMicros - chargedMicros
			account.balanceMicros += refundMicros
			record.state = "settled"
			record.chargedMicros = chargedMicros
			record.usage = input.usage
			record.settledAt = this.now().toISOString()
			return { usage: structuredClone(record), balanceMicros: account.balanceMicros }
		})
	}

	async refund(usageId: string, _reason: string): Promise<SettlementResult> {
		return await this.withMutation(() => {
			const record = this.requireUsage(usageId)
			const account = this.requireAccount(record.accountId)
			if (record.state !== "reserved") {
				return { usage: structuredClone(record), balanceMicros: account.balanceMicros }
			}
			account.balanceMicros += record.reservedMicros
			record.state = "refunded"
			record.chargedMicros = 0n
			record.settledAt = this.now().toISOString()
			return { usage: structuredClone(record), balanceMicros: account.balanceMicros }
		})
	}

	async refundExpiredReservations(cutoff: Date): Promise<number> {
		return await this.withMutation(() => {
			let refunded = 0
			for (const record of this.usage.values()) {
				if (record.state !== "reserved" || new Date(record.createdAt) >= cutoff) continue
				const account = this.requireAccount(record.accountId)
				account.balanceMicros += record.reservedMicros
				record.state = "refunded"
				record.chargedMicros = 0n
				record.settledAt = this.now().toISOString()
				refunded++
			}
			return refunded
		})
	}

	async listTopupPackages(): Promise<TopupPackage[]> {
		return [...this.topupPackages.values()]
			.toSorted((left, right) => left.sortOrder - right.sortOrder)
			.map((item) => ({ ...item }))
	}

	async createTopupOrder(input: {
		accountId: string
		packageId: string
		channel: PaymentChannel
		idempotencyKey: string
		checkoutTokenHash: string
		expiresAt: Date
	}): Promise<{ created: boolean; order: PaymentOrder }> {
		return await this.withMutation(() => {
			this.requireActiveAccount(input.accountId)
			const duplicateKey = `${input.accountId}:${input.idempotencyKey}`
			const existingId = this.topupByIdempotency.get(duplicateKey)
			if (existingId) {
				return { created: false, order: this.publicOrder(this.topupOrders.get(existingId)!) }
			}
			const topupPackage = this.topupPackages.get(input.packageId)
			if (!topupPackage) throw new RepositoryNotFoundError("Top-up package not found")
			const order: CheckoutOrder = {
				id: randomUUID(),
				accountId: input.accountId,
				packageId: topupPackage.id,
				channel: input.channel,
				state: "pending",
				amountMicros: topupPackage.amountMicros,
				creditMicros: topupPackage.creditMicros,
				checkoutTokenHash: input.checkoutTokenHash,
				providerTradeNo: null,
				providerRefundNo: null,
				createdAt: this.now().toISOString(),
				expiresAt: input.expiresAt.toISOString(),
				paidAt: null,
				creditedAt: null,
				refundedAt: null,
			}
			this.topupOrders.set(order.id, order)
			this.topupByIdempotency.set(duplicateKey, order.id)
			return { created: true, order: this.publicOrder(order) }
		})
	}

	async getTopupOrder(accountId: string, orderId: string): Promise<PaymentOrder | null> {
		const order = this.topupOrders.get(orderId)
		return order?.accountId === accountId ? this.publicOrder(order) : null
	}

	async getCheckoutOrder(
		orderId: string,
		checkoutTokenHash: string,
	): Promise<CheckoutOrder | null> {
		const order = this.topupOrders.get(orderId)
		return order?.checkoutTokenHash === checkoutTokenHash ? structuredClone(order) : null
	}

	async completeTopupPayment(
		input: PaymentNotification & { channel: PaymentChannel },
	): Promise<{ credited: boolean; order: PaymentOrder }> {
		return await this.withMutation(() => {
			const eventKey = `${input.channel}:${input.providerEventId}`
			const order = this.topupOrders.get(input.orderId)
			if (!order) throw new RepositoryNotFoundError("Top-up order not found")
			if (this.paymentEvents.has(eventKey) || order.state === "credited") {
				return { credited: false, order: this.publicOrder(order) }
			}
			if (order.channel !== input.channel || order.amountMicros !== input.amountMicros) {
				throw new Error("Payment notification does not match the order")
			}
			if (order.state !== "pending" && order.state !== "closed") {
				throw new Error("Top-up order cannot be credited")
			}
			const reusedTrade = [...this.topupOrders.values()].find(
				(item) => item.providerTradeNo === input.providerTradeNo && item.id !== order.id,
			)
			if (reusedTrade) throw new Error("Provider trade number is already in use")
			const account = this.requireAccount(order.accountId)
			account.balanceMicros += order.creditMicros
			const now = this.now().toISOString()
			order.state = "credited"
			order.providerTradeNo = input.providerTradeNo
			order.paidAt = now
			order.creditedAt = now
			this.paymentEvents.add(eventKey)
			return { credited: true, order: this.publicOrder(order) }
		})
	}

	async closeExpiredTopupOrders(now: Date): Promise<number> {
		return await this.withMutation(() => {
			let closed = 0
			for (const order of this.topupOrders.values()) {
				if (order.state === "pending" && new Date(order.expiresAt) < now) {
					order.state = "closed"
					closed++
				}
			}
			return closed
		})
	}

	async listTopupOrdersForReconciliation(
		createdAfter: Date,
		limit: number,
	): Promise<PaymentOrder[]> {
		return [...this.topupOrders.values()]
			.filter(
				(order) =>
					(order.state === "pending" || order.state === "closed") &&
					new Date(order.createdAt) >= createdAfter,
			)
			.toSorted((left, right) => left.createdAt.localeCompare(right.createdAt))
			.slice(0, limit)
			.map((order) => this.publicOrder(order))
	}

	async prepareTopupRefund(orderId: string): Promise<PaymentOrder> {
		return await this.withMutation(() => {
			const order = this.requireTopupOrder(orderId)
			if (order.state === "refunding" || order.state === "refunded") return this.publicOrder(order)
			if (order.state !== "credited") throw new Error("Top-up order cannot be refunded")
			const account = this.requireAccount(order.accountId)
			if (account.balanceMicros < order.creditMicros) {
				throw new InsufficientBalanceError("Account balance is lower than the top-up credit")
			}
			account.balanceMicros -= order.creditMicros
			order.state = "refunding"
			return this.publicOrder(order)
		})
	}

	async completeTopupRefund(orderId: string, providerRefundNo: string): Promise<PaymentOrder> {
		return await this.withMutation(() => {
			const order = this.requireTopupOrder(orderId)
			if (order.state === "refunded") return this.publicOrder(order)
			if (order.state !== "refunding") throw new Error("Top-up order is not awaiting a refund")
			order.state = "refunded"
			order.providerRefundNo = providerRefundNo
			order.refundedAt = this.now().toISOString()
			return this.publicOrder(order)
		})
	}

	async createAccount(name: string): Promise<GatewayAccount> {
		return await this.withMutation(() => {
			if (!name.trim()) throw new Error("Account name is required")
			const account: GatewayAccount = {
				id: randomUUID(),
				name: name.trim(),
				state: "active",
				balanceMicros: 0n,
			}
			this.accounts.set(account.id, account)
			return { ...account }
		})
	}

	async createToken(accountId: string): Promise<CreateTokenResult> {
		return await this.withMutation(() => {
			this.requireAccount(accountId)
			const token = generateAccessToken(this.tokenPepper)
			this.tokens.set(token.prefix, {
				accountId,
				prefix: token.prefix,
				hash: token.hash,
				revoked: false,
			})
			return { rawToken: token.raw, tokenPrefix: token.prefix }
		})
	}

	async revokeToken(tokenPrefix: string): Promise<boolean> {
		return await this.withMutation(() => {
			const token = this.tokens.get(tokenPrefix)
			if (!token || token.revoked) return false
			token.revoked = true
			return true
		})
	}

	async grantCredit(input: {
		accountId: string
		amountMicros: bigint
		idempotencyKey: string
		reason: string
	}): Promise<GatewayAccount> {
		return await this.withMutation(() => {
			if (input.amountMicros <= 0n) throw new Error("Credit amount must be greater than zero")
			if (!input.idempotencyKey.trim()) throw new Error("Credit idempotency key is required")
			const account = this.requireAccount(input.accountId)
			if (!this.grantKeys.has(input.idempotencyKey)) {
				account.balanceMicros += input.amountMicros
				this.grantKeys.add(input.idempotencyKey)
			}
			return { ...account }
		})
	}

	async setAccountState(accountId: string, state: AccountState): Promise<GatewayAccount> {
		return await this.withMutation(() => {
			const account = this.requireAccount(accountId)
			account.state = state
			return { ...account }
		})
	}

	async setPrice(input: Omit<ModelPrice, "version">): Promise<ModelPrice> {
		return await this.withMutation(() => {
			if (
				input.inputMicrosPerMillion < 0n ||
				input.outputMicrosPerMillion < 0n ||
				input.cacheReadMicrosPerMillion < 0n
			) {
				throw new Error("Model prices cannot be negative")
			}
			const current = this.prices.get(input.modelId)
			const price = { ...input, version: (current?.version ?? 0) + 1 }
			this.prices.set(price.modelId, price)
			return { ...price }
		})
	}

	private async withMutation<T>(callback: () => T | Promise<T>): Promise<T> {
		const previous = this.mutationTail
		let release = () => {}
		this.mutationTail = new Promise<void>((resolve) => {
			release = resolve
		})
		await previous
		try {
			return await callback()
		} finally {
			release()
		}
	}

	private requireAccount(accountId: string): GatewayAccount {
		const account = this.accounts.get(accountId)
		if (!account) throw new RepositoryNotFoundError("Account not found")
		return account
	}

	private requireActiveAccount(accountId: string): GatewayAccount {
		const account = this.requireAccount(accountId)
		if (account.state !== "active") throw new AccountUnavailableError("Account is frozen")
		return account
	}

	private requireUsage(usageId: string): UsageRecord {
		const usage = this.usage.get(usageId)
		if (!usage) throw new RepositoryNotFoundError("Usage record not found")
		return usage
	}

	private requireTopupOrder(orderId: string): CheckoutOrder {
		const order = this.topupOrders.get(orderId)
		if (!order) throw new RepositoryNotFoundError("Top-up order not found")
		return order
	}

	private publicOrder(order: CheckoutOrder): PaymentOrder {
		const { checkoutTokenHash: _checkoutTokenHash, ...result } = order
		return structuredClone(result)
	}

	private cloneAccount(account: GatewayAccount | null): GatewayAccount | null {
		return account ? { ...account } : null
	}
}
