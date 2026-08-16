/**
 * Deterministic consistency checks for Palot Cloud balances, top-ups, and refunds.
 */

import type { PaymentOrderState } from "./payments"

type NumericValue = bigint | number | string

export type PaymentAuditFindingCode =
	| "account_balance_mismatch"
	| "order_credit_ledger_mismatch"
	| "order_credited_event_mismatch"
	| "order_payment_metadata_incomplete"
	| "order_refund_ledger_mismatch"
	| "order_refund_metadata_incomplete"
	| "paid_order_not_credited"
	| "uncredited_order_has_credit"
	| "uncredited_order_has_credited_event"

export interface PaymentAuditFinding {
	code: PaymentAuditFindingCode
	subjectType: "account" | "order"
	subjectId: string
	expected: string
	actual: string
}

export interface PaymentAccountingAudit {
	checkedAt: string
	ok: boolean
	accountsChecked: number
	ordersChecked: number
	findings: PaymentAuditFinding[]
}

export interface PaymentAuditAccountRow {
	id: string
	balanceMicros: NumericValue
	ledgerMicros: NumericValue
}

export interface PaymentAuditOrderRow {
	id: string
	state: PaymentOrderState
	creditMicros: NumericValue
	providerTradeNo: string | null
	providerRefundNo: string | null
	paidAt: Date | string | null
	creditedAt: Date | string | null
	refundedAt: Date | string | null
	creditLedgerCount: NumericValue
	creditLedgerMicros: NumericValue
	refundLedgerCount: NumericValue
	refundLedgerMicros: NumericValue
	creditedEventCount: NumericValue
}

const CREDITED_STATES = new Set<PaymentOrderState>(["credited", "refunding", "refunded"])
const REFUND_STATES = new Set<PaymentOrderState>(["refunding", "refunded"])

function toBigInt(value: NumericValue): bigint {
	return typeof value === "bigint" ? value : BigInt(value)
}

function toCount(value: NumericValue): number {
	const count = Number(value)
	if (!Number.isSafeInteger(count) || count < 0) throw new Error("Payment audit count is invalid")
	return count
}

function addFinding(
	findings: PaymentAuditFinding[],
	code: PaymentAuditFindingCode,
	subjectType: PaymentAuditFinding["subjectType"],
	subjectId: string,
	expected: string,
	actual: string,
) {
	findings.push({ code, subjectType, subjectId, expected, actual })
}

export function analyzePaymentAccounting(
	accounts: PaymentAuditAccountRow[],
	orders: PaymentAuditOrderRow[],
	checkedAt = new Date(),
): PaymentAccountingAudit {
	const findings: PaymentAuditFinding[] = []
	for (const account of accounts) {
		const balanceMicros = toBigInt(account.balanceMicros)
		const ledgerMicros = toBigInt(account.ledgerMicros)
		if (balanceMicros !== ledgerMicros) {
			addFinding(
				findings,
				"account_balance_mismatch",
				"account",
				account.id,
				ledgerMicros.toString(),
				balanceMicros.toString(),
			)
		}
	}

	for (const order of orders) {
		const creditMicros = toBigInt(order.creditMicros)
		const creditLedgerCount = toCount(order.creditLedgerCount)
		const creditLedgerMicros = toBigInt(order.creditLedgerMicros)
		const refundLedgerCount = toCount(order.refundLedgerCount)
		const refundLedgerMicros = toBigInt(order.refundLedgerMicros)
		const creditedEventCount = toCount(order.creditedEventCount)
		const isCredited = CREDITED_STATES.has(order.state)
		const isRefund = REFUND_STATES.has(order.state)

		if (isCredited) {
			if (creditLedgerCount !== 1 || creditLedgerMicros !== creditMicros) {
				addFinding(
					findings,
					"order_credit_ledger_mismatch",
					"order",
					order.id,
					`1 entry totaling ${creditMicros}`,
					`${creditLedgerCount} entries totaling ${creditLedgerMicros}`,
				)
			}
			if (creditedEventCount !== 1) {
				addFinding(
					findings,
					"order_credited_event_mismatch",
					"order",
					order.id,
					"1 credited payment event",
					`${creditedEventCount} credited payment events`,
				)
			}
			const missingPaymentMetadata = [
				!order.providerTradeNo && "provider trade number",
				!order.paidAt && "paid time",
				!order.creditedAt && "credited time",
			].filter(Boolean)
			if (missingPaymentMetadata.length > 0) {
				addFinding(
					findings,
					"order_payment_metadata_incomplete",
					"order",
					order.id,
					"complete payment metadata",
					`missing ${missingPaymentMetadata.join(", ")}`,
				)
			}
		} else {
			if (order.state === "paid") {
				addFinding(
					findings,
					"paid_order_not_credited",
					"order",
					order.id,
					"payment and credit committed atomically",
					"order persisted in paid state",
				)
			}
			if (creditLedgerCount !== 0 || creditLedgerMicros !== 0n) {
				addFinding(
					findings,
					"uncredited_order_has_credit",
					"order",
					order.id,
					"no top-up credit ledger entries",
					`${creditLedgerCount} entries totaling ${creditLedgerMicros}`,
				)
			}
			if (creditedEventCount !== 0) {
				addFinding(
					findings,
					"uncredited_order_has_credited_event",
					"order",
					order.id,
					"no credited payment events",
					`${creditedEventCount} credited payment events`,
				)
			}
		}

		const expectedRefundMicros = isRefund ? -creditMicros : 0n
		const expectedRefundCount = isRefund ? 1 : 0
		if (refundLedgerCount !== expectedRefundCount || refundLedgerMicros !== expectedRefundMicros) {
			addFinding(
				findings,
				"order_refund_ledger_mismatch",
				"order",
				order.id,
				`${expectedRefundCount} entries totaling ${expectedRefundMicros}`,
				`${refundLedgerCount} entries totaling ${refundLedgerMicros}`,
			)
		}
		if (order.state === "refunded" && (!order.providerRefundNo || !order.refundedAt)) {
			const missing = [
				!order.providerRefundNo && "provider refund number",
				!order.refundedAt && "refunded time",
			].filter(Boolean)
			addFinding(
				findings,
				"order_refund_metadata_incomplete",
				"order",
				order.id,
				"complete refund metadata",
				`missing ${missing.join(", ")}`,
			)
		}
	}

	return {
		checkedAt: checkedAt.toISOString(),
		ok: findings.length === 0,
		accountsChecked: accounts.length,
		ordersChecked: orders.length,
		findings,
	}
}
