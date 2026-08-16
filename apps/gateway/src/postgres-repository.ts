/**
 * Transactional PostgreSQL persistence for Palot Cloud billing.
 */

import { randomUUID } from "node:crypto"
import { readdir } from "node:fs/promises"
import path from "node:path"
import { SQL } from "bun"
import {
	analyzePaymentAccounting,
	type PaymentAccountingAudit,
	type PaymentAuditAccountRow,
	type PaymentAuditOrderRow,
} from "./payment-audit"
import type {
	CheckoutOrder,
	PaymentChannel,
	PaymentNotification,
	PaymentOrder,
	PaymentOrderState,
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

interface AccountRow {
	id: string
	name: string
	state: AccountState
	balanceMicros: bigint | string | number
}

interface PriceRow {
	modelId: string
	version: number
	inputMicrosPerMillion: bigint | string | number
	outputMicrosPerMillion: bigint | string | number
	cacheReadMicrosPerMillion: bigint | string | number
}

interface UsageRow {
	id: string
	accountId: string
	idempotencyKey: string
	modelId: string
	priceVersion: number
	state: UsageRecord["state"]
	reservedMicros: bigint | string | number
	chargedMicros: bigint | string | number
	inputTokens: number | null
	outputTokens: number | null
	cacheReadTokens: number | null
	usageSource: TokenUsage["source"] | null
	createdAt: Date | string
	settledAt: Date | string | null
}

interface TopupPackageRow {
	id: string
	label: string
	amountMicros: bigint | string | number
	creditMicros: bigint | string | number
	sortOrder: number
}

interface PaymentOrderRow {
	id: string
	accountId: string
	packageId: string
	channel: PaymentChannel
	state: PaymentOrderState
	amountMicros: bigint | string | number
	creditMicros: bigint | string | number
	checkoutTokenHash: string
	providerTradeNo: string | null
	providerRefundNo: string | null
	createdAt: Date | string
	expiresAt: Date | string
	paidAt: Date | string | null
	creditedAt: Date | string | null
	refundedAt: Date | string | null
}

function toBigInt(value: bigint | string | number): bigint {
	return typeof value === "bigint" ? value : BigInt(value)
}

function mapAccount(row: AccountRow): GatewayAccount {
	return {
		id: row.id,
		name: row.name,
		state: row.state,
		balanceMicros: toBigInt(row.balanceMicros),
	}
}

function mapPrice(row: PriceRow): ModelPrice {
	return {
		modelId: row.modelId,
		version: row.version,
		inputMicrosPerMillion: toBigInt(row.inputMicrosPerMillion),
		outputMicrosPerMillion: toBigInt(row.outputMicrosPerMillion),
		cacheReadMicrosPerMillion: toBigInt(row.cacheReadMicrosPerMillion),
	}
}

function toIsoString(value: Date | string): string {
	return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function mapUsage(row: UsageRow): UsageRecord {
	const usage =
		row.inputTokens === null ||
		row.outputTokens === null ||
		row.cacheReadTokens === null ||
		row.usageSource === null
			? null
			: {
					inputTokens: row.inputTokens,
					outputTokens: row.outputTokens,
					cacheReadTokens: row.cacheReadTokens,
					source: row.usageSource,
				}
	return {
		id: row.id,
		accountId: row.accountId,
		idempotencyKey: row.idempotencyKey,
		modelId: row.modelId,
		priceVersion: row.priceVersion,
		state: row.state,
		reservedMicros: toBigInt(row.reservedMicros),
		chargedMicros: toBigInt(row.chargedMicros),
		usage,
		createdAt: toIsoString(row.createdAt),
		settledAt: row.settledAt ? toIsoString(row.settledAt) : null,
	}
}

function mapTopupPackage(row: TopupPackageRow): TopupPackage {
	return {
		id: row.id,
		label: row.label,
		amountMicros: toBigInt(row.amountMicros),
		creditMicros: toBigInt(row.creditMicros),
		sortOrder: row.sortOrder,
	}
}

function mapCheckoutOrder(row: PaymentOrderRow): CheckoutOrder {
	return {
		id: row.id,
		accountId: row.accountId,
		packageId: row.packageId,
		channel: row.channel,
		state: row.state,
		amountMicros: toBigInt(row.amountMicros),
		creditMicros: toBigInt(row.creditMicros),
		checkoutTokenHash: row.checkoutTokenHash,
		providerTradeNo: row.providerTradeNo,
		providerRefundNo: row.providerRefundNo,
		createdAt: toIsoString(row.createdAt),
		expiresAt: toIsoString(row.expiresAt),
		paidAt: row.paidAt ? toIsoString(row.paidAt) : null,
		creditedAt: row.creditedAt ? toIsoString(row.creditedAt) : null,
		refundedAt: row.refundedAt ? toIsoString(row.refundedAt) : null,
	}
}

function mapPaymentOrder(row: PaymentOrderRow): PaymentOrder {
	const { checkoutTokenHash: _checkoutTokenHash, ...order } = mapCheckoutOrder(row)
	return order
}

const PRICE_COLUMNS = `
	model_id AS "modelId",
	version,
	input_micros_per_million AS "inputMicrosPerMillion",
	output_micros_per_million AS "outputMicrosPerMillion",
	cache_read_micros_per_million AS "cacheReadMicrosPerMillion"
`

const USAGE_COLUMNS = `
	id,
	account_id AS "accountId",
	idempotency_key AS "idempotencyKey",
	model_id AS "modelId",
	price_version AS "priceVersion",
	state,
	reserved_micros AS "reservedMicros",
	charged_micros AS "chargedMicros",
	input_tokens AS "inputTokens",
	output_tokens AS "outputTokens",
	cache_read_tokens AS "cacheReadTokens",
	usage_source AS "usageSource",
	created_at AS "createdAt",
	settled_at AS "settledAt"
`

const PAYMENT_ORDER_COLUMNS = `
	id,
	account_id AS "accountId",
	package_id AS "packageId",
	channel,
	state,
	amount_micros AS "amountMicros",
	credit_micros AS "creditMicros",
	checkout_token_hash AS "checkoutTokenHash",
	provider_trade_no AS "providerTradeNo",
	provider_refund_no AS "providerRefundNo",
	created_at AS "createdAt",
	expires_at AS "expiresAt",
	paid_at AS "paidAt",
	credited_at AS "creditedAt",
	refunded_at AS "refundedAt"
`

export class PostgresGatewayRepository implements GatewayRepository {
	private readonly sql: SQL

	constructor(
		databaseUrl: string,
		private readonly tokenPepper: string,
	) {
		this.sql = new SQL(databaseUrl, { max: 10, idleTimeout: 30 })
	}

	async migrate(): Promise<void> {
		const migrationDirectory = path.join(import.meta.dir, "../migrations")
		const migrations = (await readdir(migrationDirectory))
			.filter((name) => /^\d+_[a-z0-9_-]+\.sql$/.test(name))
			.toSorted()
		for (const migration of migrations)
			await this.sql.file(path.join(migrationDirectory, migration))
	}

	async close(): Promise<void> {
		await this.sql.close({ timeout: 5 })
	}

	async health(): Promise<boolean> {
		await this.sql`SELECT 1 AS ok`
		return true
	}

	async auditPaymentAccounting(): Promise<PaymentAccountingAudit> {
		return await this.sql.begin(
			"isolation level repeatable read read only",
			async (transaction) => {
				const accounts = await transaction<PaymentAuditAccountRow[]>`
				SELECT
					a.id,
					a.balance_micros AS "balanceMicros",
					COALESCE((
						SELECT SUM(l.amount_micros)
						FROM ledger_entries l
						WHERE l.account_id = a.id
					), 0) AS "ledgerMicros"
				FROM accounts a
				ORDER BY a.id
				`
				const orders = await transaction<PaymentAuditOrderRow[]>`
				SELECT
					o.id,
					o.state,
					o.credit_micros AS "creditMicros",
					o.provider_trade_no AS "providerTradeNo",
					o.provider_refund_no AS "providerRefundNo",
					o.paid_at AS "paidAt",
					o.credited_at AS "creditedAt",
					o.refunded_at AS "refundedAt",
					(
						SELECT COUNT(*)::int
						FROM ledger_entries l
						WHERE l.idempotency_key = 'topup:' || o.id::text
					) AS "creditLedgerCount",
					COALESCE((
						SELECT SUM(l.amount_micros)
						FROM ledger_entries l
						WHERE l.idempotency_key = 'topup:' || o.id::text
					), 0) AS "creditLedgerMicros",
					(
						SELECT COUNT(*)::int
						FROM ledger_entries l
						WHERE l.idempotency_key = 'topup-refund:' || o.id::text
					) AS "refundLedgerCount",
					COALESCE((
						SELECT SUM(l.amount_micros)
						FROM ledger_entries l
						WHERE l.idempotency_key = 'topup-refund:' || o.id::text
					), 0) AS "refundLedgerMicros",
					(
						SELECT COUNT(*)::int
						FROM payment_events e
						WHERE e.order_id = o.id AND e.result = 'credited'
					) AS "creditedEventCount"
				FROM payment_orders o
				ORDER BY o.created_at, o.id
				`
				return analyzePaymentAccounting(accounts, orders)
			},
		)
	}

	async authenticate(rawToken: string): Promise<GatewayAccount | null> {
		const prefix = parseAccessTokenPrefix(rawToken)
		if (!prefix) return null
		const rows = await this.sql<(AccountRow & { tokenHash: string })[]>`
			SELECT
				a.id,
				a.name,
				a.state,
				a.balance_micros AS "balanceMicros",
				t.token_hash AS "tokenHash"
			FROM access_tokens t
			JOIN accounts a ON a.id = t.account_id
			WHERE t.token_prefix = ${prefix} AND t.revoked_at IS NULL
			LIMIT 1
		`
		const row = rows[0]
		if (!row || !accessTokenHashMatches(rawToken, row.tokenHash, this.tokenPepper)) return null
		await this.sql`
			UPDATE access_tokens SET last_used_at = NOW() WHERE token_prefix = ${prefix}
		`
		return mapAccount(row)
	}

	async getAccountSummary(accountId: string): Promise<AccountSummary | null> {
		const accounts = await this.sql<AccountRow[]>`
			SELECT id, name, state, balance_micros AS "balanceMicros"
			FROM accounts WHERE id = ${accountId}
		`
		const account = accounts[0]
		if (!account) return null
		const recentUsage = await this.sql<UsageRow[]>`
			SELECT ${this.sql.unsafe(USAGE_COLUMNS)}
			FROM usage_records
			WHERE account_id = ${accountId}
			ORDER BY created_at DESC
			LIMIT 20
		`
		const recentTopups = await this.sql<PaymentOrderRow[]>`
			SELECT ${this.sql.unsafe(PAYMENT_ORDER_COLUMNS)}
			FROM payment_orders
			WHERE account_id = ${accountId}
			ORDER BY created_at DESC
			LIMIT 10
		`
		return {
			...mapAccount(account),
			recentUsage: recentUsage.map(mapUsage),
			recentTopups: recentTopups.map(mapPaymentOrder),
		}
	}

	async listActivePrices(): Promise<ModelPrice[]> {
		const rows = await this.sql<PriceRow[]>`
			SELECT ${this.sql.unsafe(PRICE_COLUMNS)}
			FROM model_prices WHERE active = TRUE ORDER BY model_id
		`
		return rows.map(mapPrice)
	}

	async getActivePrice(modelId: string): Promise<ModelPrice | null> {
		const rows = await this.sql<PriceRow[]>`
			SELECT ${this.sql.unsafe(PRICE_COLUMNS)}
			FROM model_prices WHERE model_id = ${modelId} AND active = TRUE LIMIT 1
		`
		return rows[0] ? mapPrice(rows[0]) : null
	}

	async reserve(input: {
		accountId: string
		idempotencyKey: string
		modelId: string
		priceVersion: number
		reservedMicros: bigint
	}): Promise<ReservationResult> {
		if (input.reservedMicros <= 0n) throw new Error("Reservation must be greater than zero")
		return await this.sql.begin("isolation level serializable", async (transaction) => {
			const existing = await transaction<UsageRow[]>`
				SELECT ${transaction.unsafe(USAGE_COLUMNS)}
				FROM usage_records
				WHERE account_id = ${input.accountId} AND idempotency_key = ${input.idempotencyKey}
				FOR UPDATE
			`
			if (existing[0]) {
				const accounts = await transaction<AccountRow[]>`
					SELECT id, name, state, balance_micros AS "balanceMicros"
					FROM accounts WHERE id = ${input.accountId}
				`
				return {
					created: false,
					usage: mapUsage(existing[0]),
					balanceMicros: accounts[0] ? mapAccount(accounts[0]).balanceMicros : 0n,
				}
			}
			const accounts = await transaction<AccountRow[]>`
				SELECT id, name, state, balance_micros AS "balanceMicros"
				FROM accounts WHERE id = ${input.accountId} FOR UPDATE
			`
			const accountRow = accounts[0]
			if (!accountRow) throw new RepositoryNotFoundError("Account not found")
			const account = mapAccount(accountRow)
			if (account.state !== "active") throw new AccountUnavailableError("Account is frozen")
			if (account.balanceMicros < input.reservedMicros) {
				throw new InsufficientBalanceError("Insufficient Palot Cloud balance")
			}
			const balanceMicros = account.balanceMicros - input.reservedMicros
			await transaction`
				UPDATE accounts
				SET balance_micros = ${balanceMicros}, updated_at = NOW()
				WHERE id = ${input.accountId}
			`
			const usageId = randomUUID()
			const rows = await transaction<UsageRow[]>`
				INSERT INTO usage_records (
					id, account_id, idempotency_key, model_id, price_version, state, reserved_micros
				) VALUES (
					${usageId}, ${input.accountId}, ${input.idempotencyKey}, ${input.modelId},
					${input.priceVersion}, 'reserved', ${input.reservedMicros}
				)
				RETURNING ${transaction.unsafe(USAGE_COLUMNS)}
			`
			await transaction`
				INSERT INTO ledger_entries (
					account_id, usage_id, kind, amount_micros, balance_after_micros,
					idempotency_key, reason
				) VALUES (
					${input.accountId}, ${usageId}, 'reserve', ${-input.reservedMicros},
					${balanceMicros}, ${`reserve:${usageId}`}, 'Model request reservation'
				)
			`
			return { created: true, usage: mapUsage(rows[0]), balanceMicros }
		})
	}

	async settle(input: {
		usageId: string
		chargedMicros: bigint
		usage: TokenUsage
	}): Promise<SettlementResult> {
		if (input.chargedMicros < 0n) throw new Error("Charge cannot be negative")
		return await this.sql.begin("isolation level serializable", async (transaction) => {
			const records = await transaction<UsageRow[]>`
				SELECT ${transaction.unsafe(USAGE_COLUMNS)}
				FROM usage_records WHERE id = ${input.usageId} FOR UPDATE
			`
			const recordRow = records[0]
			if (!recordRow) throw new RepositoryNotFoundError("Usage record not found")
			const record = mapUsage(recordRow)
			const accounts = await transaction<AccountRow[]>`
				SELECT id, name, state, balance_micros AS "balanceMicros"
				FROM accounts WHERE id = ${record.accountId} FOR UPDATE
			`
			if (!accounts[0]) throw new RepositoryNotFoundError("Account not found")
			const account = mapAccount(accounts[0])
			if (record.state !== "reserved") {
				return { usage: record, balanceMicros: account.balanceMicros }
			}
			const chargedMicros =
				input.chargedMicros > record.reservedMicros ? record.reservedMicros : input.chargedMicros
			const refundMicros = record.reservedMicros - chargedMicros
			const balanceMicros = account.balanceMicros + refundMicros
			await transaction`
				UPDATE accounts
				SET balance_micros = ${balanceMicros}, updated_at = NOW()
				WHERE id = ${record.accountId}
			`
			const updated = await transaction<UsageRow[]>`
				UPDATE usage_records SET
					state = 'settled',
					charged_micros = ${chargedMicros},
					input_tokens = ${input.usage.inputTokens},
					output_tokens = ${input.usage.outputTokens},
					cache_read_tokens = ${input.usage.cacheReadTokens},
					usage_source = ${input.usage.source},
					settled_at = NOW()
				WHERE id = ${record.id}
				RETURNING ${transaction.unsafe(USAGE_COLUMNS)}
			`
			await transaction`
				INSERT INTO ledger_entries (
					account_id, usage_id, kind, amount_micros, balance_after_micros,
					idempotency_key, reason
				) VALUES (
					${record.accountId}, ${record.id}, 'settlement', ${refundMicros},
					${balanceMicros}, ${`settle:${record.id}`}, 'Release unused reservation'
				)
			`
			return { usage: mapUsage(updated[0]), balanceMicros }
		})
	}

	async refund(usageId: string, reason: string): Promise<SettlementResult> {
		return await this.sql.begin("isolation level serializable", async (transaction) => {
			const records = await transaction<UsageRow[]>`
				SELECT ${transaction.unsafe(USAGE_COLUMNS)}
				FROM usage_records WHERE id = ${usageId} FOR UPDATE
			`
			const recordRow = records[0]
			if (!recordRow) throw new RepositoryNotFoundError("Usage record not found")
			const record = mapUsage(recordRow)
			const accounts = await transaction<AccountRow[]>`
				SELECT id, name, state, balance_micros AS "balanceMicros"
				FROM accounts WHERE id = ${record.accountId} FOR UPDATE
			`
			if (!accounts[0]) throw new RepositoryNotFoundError("Account not found")
			const account = mapAccount(accounts[0])
			if (record.state !== "reserved") {
				return { usage: record, balanceMicros: account.balanceMicros }
			}
			const balanceMicros = account.balanceMicros + record.reservedMicros
			await transaction`
				UPDATE accounts SET balance_micros = ${balanceMicros}, updated_at = NOW()
				WHERE id = ${record.accountId}
			`
			const updated = await transaction<UsageRow[]>`
				UPDATE usage_records
				SET state = 'refunded', charged_micros = 0, settled_at = NOW()
				WHERE id = ${record.id}
				RETURNING ${transaction.unsafe(USAGE_COLUMNS)}
			`
			await transaction`
				INSERT INTO ledger_entries (
					account_id, usage_id, kind, amount_micros, balance_after_micros,
					idempotency_key, reason
				) VALUES (
					${record.accountId}, ${record.id}, 'refund', ${record.reservedMicros},
					${balanceMicros}, ${`refund:${record.id}`}, ${reason.slice(0, 300)}
				)
			`
			return { usage: mapUsage(updated[0]), balanceMicros }
		})
	}

	async refundExpiredReservations(cutoff: Date): Promise<number> {
		return await this.sql.begin("isolation level serializable", async (transaction) => {
			const records = await transaction<UsageRow[]>`
				SELECT ${transaction.unsafe(USAGE_COLUMNS)}
				FROM usage_records
				WHERE state = 'reserved' AND created_at < ${cutoff}
				ORDER BY created_at, id
				FOR UPDATE SKIP LOCKED
			`
			for (const recordRow of records) {
				const record = mapUsage(recordRow)
				const accounts = await transaction<AccountRow[]>`
					SELECT id, name, state, balance_micros AS "balanceMicros"
					FROM accounts WHERE id = ${record.accountId} FOR UPDATE
				`
				if (!accounts[0]) throw new RepositoryNotFoundError("Account not found")
				const balanceMicros = mapAccount(accounts[0]).balanceMicros + record.reservedMicros
				await transaction`
					UPDATE accounts SET balance_micros = ${balanceMicros}, updated_at = NOW()
					WHERE id = ${record.accountId}
				`
				await transaction`
					UPDATE usage_records
					SET state = 'refunded', charged_micros = 0, settled_at = NOW()
					WHERE id = ${record.id}
				`
				await transaction`
					INSERT INTO ledger_entries (
						account_id, usage_id, kind, amount_micros, balance_after_micros,
						idempotency_key, reason
					) VALUES (
						${record.accountId}, ${record.id}, 'refund', ${record.reservedMicros},
						${balanceMicros}, ${`expire:${record.id}`}, 'Expired request reservation'
					)
				`
			}
			return records.length
		})
	}

	async listTopupPackages(): Promise<TopupPackage[]> {
		const rows = await this.sql<TopupPackageRow[]>`
			SELECT
				id,
				label,
				amount_micros AS "amountMicros",
				credit_micros AS "creditMicros",
				sort_order AS "sortOrder"
			FROM topup_packages
			WHERE active = TRUE
			ORDER BY sort_order, id
		`
		return rows.map(mapTopupPackage)
	}

	async createTopupOrder(input: {
		accountId: string
		packageId: string
		channel: PaymentChannel
		idempotencyKey: string
		checkoutTokenHash: string
		expiresAt: Date
	}): Promise<{ created: boolean; order: PaymentOrder }> {
		return await this.sql.begin("isolation level serializable", async (transaction) => {
			const existing = await transaction<PaymentOrderRow[]>`
				SELECT ${transaction.unsafe(PAYMENT_ORDER_COLUMNS)}
				FROM payment_orders
				WHERE account_id = ${input.accountId} AND idempotency_key = ${input.idempotencyKey}
				FOR UPDATE
			`
			if (existing[0]) return { created: false, order: mapPaymentOrder(existing[0]) }
			const accounts = await transaction<AccountRow[]>`
				SELECT id, name, state, balance_micros AS "balanceMicros"
				FROM accounts WHERE id = ${input.accountId} FOR UPDATE
			`
			if (!accounts[0]) throw new RepositoryNotFoundError("Account not found")
			if (accounts[0].state !== "active") throw new AccountUnavailableError("Account is frozen")
			const packages = await transaction<TopupPackageRow[]>`
				SELECT
					id, label, amount_micros AS "amountMicros",
					credit_micros AS "creditMicros", sort_order AS "sortOrder"
				FROM topup_packages WHERE id = ${input.packageId} AND active = TRUE
			`
			const topupPackage = packages[0]
			if (!topupPackage) throw new RepositoryNotFoundError("Top-up package not found")
			const rows = await transaction<PaymentOrderRow[]>`
				INSERT INTO payment_orders (
					id, account_id, package_id, channel, state, amount_micros, credit_micros,
					idempotency_key, checkout_token_hash, expires_at
				) VALUES (
					${randomUUID()}, ${input.accountId}, ${input.packageId}, ${input.channel}, 'pending',
					${topupPackage.amountMicros}, ${topupPackage.creditMicros}, ${input.idempotencyKey},
					${input.checkoutTokenHash}, ${input.expiresAt}
				)
				RETURNING ${transaction.unsafe(PAYMENT_ORDER_COLUMNS)}
			`
			return { created: true, order: mapPaymentOrder(rows[0]) }
		})
	}

	async getTopupOrder(accountId: string, orderId: string): Promise<PaymentOrder | null> {
		const rows = await this.sql<PaymentOrderRow[]>`
			SELECT ${this.sql.unsafe(PAYMENT_ORDER_COLUMNS)}
			FROM payment_orders WHERE id = ${orderId} AND account_id = ${accountId}
		`
		return rows[0] ? mapPaymentOrder(rows[0]) : null
	}

	async getCheckoutOrder(
		orderId: string,
		checkoutTokenHash: string,
	): Promise<CheckoutOrder | null> {
		const rows = await this.sql<PaymentOrderRow[]>`
			SELECT ${this.sql.unsafe(PAYMENT_ORDER_COLUMNS)}
			FROM payment_orders
			WHERE id = ${orderId} AND checkout_token_hash = ${checkoutTokenHash}
		`
		return rows[0] ? mapCheckoutOrder(rows[0]) : null
	}

	async completeTopupPayment(
		input: PaymentNotification & { channel: PaymentChannel },
	): Promise<{ credited: boolean; order: PaymentOrder }> {
		return await this.sql.begin("isolation level serializable", async (transaction) => {
			const priorEvents = await transaction<{ orderId: string }[]>`
				SELECT order_id AS "orderId" FROM payment_events
				WHERE channel = ${input.channel} AND provider_event_id = ${input.providerEventId}
			`
			const rows = await transaction<PaymentOrderRow[]>`
				SELECT ${transaction.unsafe(PAYMENT_ORDER_COLUMNS)}
				FROM payment_orders WHERE id = ${input.orderId} FOR UPDATE
			`
			const row = rows[0]
			if (!row) throw new RepositoryNotFoundError("Top-up order not found")
			if (priorEvents[0]) return { credited: false, order: mapPaymentOrder(row) }
			const order = mapCheckoutOrder(row)
			if (order.channel !== input.channel || order.amountMicros !== input.amountMicros) {
				throw new Error("Payment notification does not match the order")
			}
			if (order.state === "credited" || order.state === "refunding" || order.state === "refunded") {
				await transaction`
					INSERT INTO payment_events (
						channel, provider_event_id, provider_trade_no, order_id, payload_hash, result
					) VALUES (
						${input.channel}, ${input.providerEventId}, ${input.providerTradeNo},
						${order.id}, ${input.payloadHash}, 'duplicate'
					)
				`
				return { credited: false, order: mapPaymentOrder(row) }
			}
			if (order.state !== "pending" && order.state !== "closed") {
				throw new Error("Top-up order cannot be credited")
			}
			const accounts = await transaction<AccountRow[]>`
				SELECT id, name, state, balance_micros AS "balanceMicros"
				FROM accounts WHERE id = ${order.accountId} FOR UPDATE
			`
			if (!accounts[0]) throw new RepositoryNotFoundError("Account not found")
			const balanceMicros = mapAccount(accounts[0]).balanceMicros + order.creditMicros
			await transaction`
				UPDATE accounts SET balance_micros = ${balanceMicros}, updated_at = NOW()
				WHERE id = ${order.accountId}
			`
			const updated = await transaction<PaymentOrderRow[]>`
				UPDATE payment_orders SET
					state = 'credited', provider_trade_no = ${input.providerTradeNo},
					paid_at = NOW(), credited_at = NOW()
				WHERE id = ${order.id}
				RETURNING ${transaction.unsafe(PAYMENT_ORDER_COLUMNS)}
			`
			await transaction`
				INSERT INTO ledger_entries (
					account_id, kind, amount_micros, balance_after_micros, idempotency_key, reason
				) VALUES (
					${order.accountId}, 'credit', ${order.creditMicros}, ${balanceMicros},
					${`topup:${order.id}`}, 'Payment top-up'
				)
			`
			await transaction`
				INSERT INTO payment_events (
					channel, provider_event_id, provider_trade_no, order_id, payload_hash, result
				) VALUES (
					${input.channel}, ${input.providerEventId}, ${input.providerTradeNo},
					${order.id}, ${input.payloadHash}, 'credited'
				)
			`
			return { credited: true, order: mapPaymentOrder(updated[0]) }
		})
	}

	async closeExpiredTopupOrders(now: Date): Promise<number> {
		const rows = await this.sql<{ id: string }[]>`
			UPDATE payment_orders SET state = 'closed'
			WHERE state = 'pending' AND expires_at < ${now}
			RETURNING id
		`
		return rows.length
	}

	async listTopupOrdersForReconciliation(
		createdAfter: Date,
		limit: number,
	): Promise<PaymentOrder[]> {
		if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
			throw new Error("Reconciliation limit must be between 1 and 500")
		}
		const rows = await this.sql<PaymentOrderRow[]>`
			SELECT ${this.sql.unsafe(PAYMENT_ORDER_COLUMNS)}
			FROM payment_orders
			WHERE state IN ('pending', 'closed') AND created_at >= ${createdAfter}
			ORDER BY created_at
			LIMIT ${limit}
		`
		return rows.map(mapPaymentOrder)
	}

	async prepareTopupRefund(orderId: string): Promise<PaymentOrder> {
		return await this.sql.begin("isolation level serializable", async (transaction) => {
			const rows = await transaction<PaymentOrderRow[]>`
				SELECT ${transaction.unsafe(PAYMENT_ORDER_COLUMNS)}
				FROM payment_orders WHERE id = ${orderId} FOR UPDATE
			`
			const row = rows[0]
			if (!row) throw new RepositoryNotFoundError("Top-up order not found")
			const order = mapCheckoutOrder(row)
			if (order.state === "refunding" || order.state === "refunded") return mapPaymentOrder(row)
			if (order.state !== "credited") throw new Error("Top-up order cannot be refunded")
			const accounts = await transaction<AccountRow[]>`
				SELECT id, name, state, balance_micros AS "balanceMicros"
				FROM accounts WHERE id = ${order.accountId} FOR UPDATE
			`
			if (!accounts[0]) throw new RepositoryNotFoundError("Account not found")
			const account = mapAccount(accounts[0])
			if (account.balanceMicros < order.creditMicros) {
				throw new InsufficientBalanceError("Account balance is lower than the top-up credit")
			}
			const balanceMicros = account.balanceMicros - order.creditMicros
			await transaction`
				UPDATE accounts SET balance_micros = ${balanceMicros}, updated_at = NOW()
				WHERE id = ${order.accountId}
			`
			const updated = await transaction<PaymentOrderRow[]>`
				UPDATE payment_orders SET state = 'refunding' WHERE id = ${order.id}
				RETURNING ${transaction.unsafe(PAYMENT_ORDER_COLUMNS)}
			`
			await transaction`
				INSERT INTO ledger_entries (
					account_id, kind, amount_micros, balance_after_micros, idempotency_key, reason
				) VALUES (
					${order.accountId}, 'adjustment', ${-order.creditMicros}, ${balanceMicros},
					${`topup-refund:${order.id}`}, 'Reserve balance for payment refund'
				)
			`
			return mapPaymentOrder(updated[0])
		})
	}

	async completeTopupRefund(orderId: string, providerRefundNo: string): Promise<PaymentOrder> {
		const rows = await this.sql<PaymentOrderRow[]>`
			UPDATE payment_orders SET
				state = 'refunded', provider_refund_no = ${providerRefundNo}, refunded_at = NOW()
			WHERE id = ${orderId} AND state = 'refunding'
			RETURNING ${this.sql.unsafe(PAYMENT_ORDER_COLUMNS)}
		`
		if (rows[0]) return mapPaymentOrder(rows[0])
		const existing = await this.sql<PaymentOrderRow[]>`
			SELECT ${this.sql.unsafe(PAYMENT_ORDER_COLUMNS)} FROM payment_orders WHERE id = ${orderId}
		`
		if (existing[0]?.state === "refunded") return mapPaymentOrder(existing[0])
		throw new RepositoryNotFoundError("Refunding top-up order not found")
	}

	async createAccount(name: string): Promise<GatewayAccount> {
		if (!name.trim()) throw new Error("Account name is required")
		const rows = await this.sql<AccountRow[]>`
			INSERT INTO accounts (id, name)
			VALUES (${randomUUID()}, ${name.trim()})
			RETURNING id, name, state, balance_micros AS "balanceMicros"
		`
		return mapAccount(rows[0])
	}

	async createToken(accountId: string): Promise<CreateTokenResult> {
		const token = generateAccessToken(this.tokenPepper)
		await this.sql`
			INSERT INTO access_tokens (id, account_id, token_prefix, token_hash)
			VALUES (${randomUUID()}, ${accountId}, ${token.prefix}, ${token.hash})
		`
		return { rawToken: token.raw, tokenPrefix: token.prefix }
	}

	async revokeToken(tokenPrefix: string): Promise<boolean> {
		const rows = await this.sql<{ id: string }[]>`
			UPDATE access_tokens SET revoked_at = NOW()
			WHERE token_prefix = ${tokenPrefix} AND revoked_at IS NULL
			RETURNING id
		`
		return rows.length > 0
	}

	async grantCredit(input: {
		accountId: string
		amountMicros: bigint
		idempotencyKey: string
		reason: string
	}): Promise<GatewayAccount> {
		if (input.amountMicros <= 0n) throw new Error("Credit amount must be greater than zero")
		if (!input.idempotencyKey.trim()) throw new Error("Credit idempotency key is required")
		return await this.sql.begin("isolation level serializable", async (transaction) => {
			const existing = await transaction<{ accountId: string }[]>`
				SELECT account_id AS "accountId" FROM ledger_entries
				WHERE idempotency_key = ${input.idempotencyKey}
			`
			if (existing[0] && existing[0].accountId !== input.accountId) {
				throw new Error("Credit idempotency key belongs to another account")
			}
			const accounts = await transaction<AccountRow[]>`
				SELECT id, name, state, balance_micros AS "balanceMicros"
				FROM accounts WHERE id = ${input.accountId} FOR UPDATE
			`
			if (!accounts[0]) throw new RepositoryNotFoundError("Account not found")
			if (existing[0]) return mapAccount(accounts[0])
			const account = mapAccount(accounts[0])
			const balanceMicros = account.balanceMicros + input.amountMicros
			const updated = await transaction<AccountRow[]>`
				UPDATE accounts SET balance_micros = ${balanceMicros}, updated_at = NOW()
				WHERE id = ${input.accountId}
				RETURNING id, name, state, balance_micros AS "balanceMicros"
			`
			await transaction`
				INSERT INTO ledger_entries (
					account_id, kind, amount_micros, balance_after_micros, idempotency_key, reason
				) VALUES (
					${input.accountId}, 'credit', ${input.amountMicros}, ${balanceMicros},
					${input.idempotencyKey}, ${input.reason.slice(0, 300)}
				)
			`
			return mapAccount(updated[0])
		})
	}

	async setAccountState(accountId: string, state: AccountState): Promise<GatewayAccount> {
		const rows = await this.sql<AccountRow[]>`
			UPDATE accounts SET state = ${state}, updated_at = NOW()
			WHERE id = ${accountId}
			RETURNING id, name, state, balance_micros AS "balanceMicros"
		`
		if (!rows[0]) throw new RepositoryNotFoundError("Account not found")
		return mapAccount(rows[0])
	}

	async setPrice(input: Omit<ModelPrice, "version">): Promise<ModelPrice> {
		if (
			input.inputMicrosPerMillion < 0n ||
			input.outputMicrosPerMillion < 0n ||
			input.cacheReadMicrosPerMillion < 0n
		) {
			throw new Error("Model prices cannot be negative")
		}
		return await this.sql.begin("isolation level serializable", async (transaction) => {
			await transaction`SELECT pg_advisory_xact_lock(hashtext(${input.modelId}))`
			const versions = await transaction<{ version: number }[]>`
				SELECT COALESCE(MAX(version), 0)::int AS version
				FROM model_prices WHERE model_id = ${input.modelId}
			`
			const version = (versions[0]?.version ?? 0) + 1
			await transaction`
				UPDATE model_prices SET active = FALSE
				WHERE model_id = ${input.modelId} AND active = TRUE
			`
			const rows = await transaction<PriceRow[]>`
				INSERT INTO model_prices (
					id, model_id, version, input_micros_per_million,
					output_micros_per_million, cache_read_micros_per_million, active
				) VALUES (
					${randomUUID()}, ${input.modelId}, ${version}, ${input.inputMicrosPerMillion},
					${input.outputMicrosPerMillion}, ${input.cacheReadMicrosPerMillion}, TRUE
				)
				RETURNING ${transaction.unsafe(PRICE_COLUMNS)}
			`
			return mapPrice(rows[0])
		})
	}
}
