import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { analyzePaymentAccounting, type PaymentAuditOrderRow } from "./payment-audit"

const checkedAt = new Date("2026-08-16T00:00:00.000Z")

function order(overrides: Partial<PaymentAuditOrderRow> = {}): PaymentAuditOrderRow {
	return {
		id: "4c9e3782-a498-45b4-82cc-3f14cecdf5d6",
		state: "credited",
		creditMicros: 10_000_000n,
		providerTradeNo: "trade-1",
		providerRefundNo: null,
		paidAt: "2026-08-16T00:01:00.000Z",
		creditedAt: "2026-08-16T00:01:00.000Z",
		refundedAt: null,
		creditLedgerCount: 1,
		creditLedgerMicros: 10_000_000n,
		refundLedgerCount: 0,
		refundLedgerMicros: 0n,
		creditedEventCount: 1,
		...overrides,
	}
}

describe("Palot Cloud payment accounting audit", () => {
	it("accepts balanced credits, refund reservations, and pending orders", () => {
		const report = analyzePaymentAccounting(
			[
				{ id: "account-1", balanceMicros: 20_000_000n, ledgerMicros: 20_000_000n },
				{ id: "account-2", balanceMicros: "0", ledgerMicros: 0 },
			],
			[
				order(),
				order({
					id: "refunding-order",
					state: "refunding",
					creditMicros: 30_000_000n,
					creditLedgerMicros: 30_000_000n,
					refundLedgerCount: 1,
					refundLedgerMicros: -30_000_000n,
				}),
				order({
					id: "refunded-order",
					state: "refunded",
					providerRefundNo: "refund-1",
					refundedAt: "2026-08-16T00:02:00.000Z",
					refundLedgerCount: 1,
					refundLedgerMicros: -10_000_000n,
				}),
				order({
					id: "pending-order",
					state: "pending",
					providerTradeNo: null,
					paidAt: null,
					creditedAt: null,
					creditLedgerCount: 0,
					creditLedgerMicros: 0n,
					creditedEventCount: 0,
				}),
			],
			checkedAt,
		)

		assert.equal(report.ok, true)
		assert.equal(report.accountsChecked, 2)
		assert.equal(report.ordersChecked, 4)
		assert.deepEqual(report.findings, [])
		assert.equal(report.checkedAt, checkedAt.toISOString())
	})

	it("reports balance, credit, event, metadata, and refund inconsistencies", () => {
		const report = analyzePaymentAccounting(
			[{ id: "account-1", balanceMicros: 10n, ledgerMicros: 20n }],
			[
				order({
					providerTradeNo: null,
					paidAt: null,
					creditedAt: null,
					creditLedgerCount: 0,
					creditLedgerMicros: 0n,
					refundLedgerCount: 1,
					refundLedgerMicros: -10_000_000n,
					creditedEventCount: 0,
				}),
				order({
					id: "pending-order",
					state: "pending",
					providerTradeNo: null,
					paidAt: null,
					creditedAt: null,
					creditLedgerMicros: 10_000_000n,
				}),
			],
			checkedAt,
		)

		assert.equal(report.ok, false)
		assert.deepEqual(
			report.findings.map((finding) => finding.code),
			[
				"account_balance_mismatch",
				"order_credit_ledger_mismatch",
				"order_credited_event_mismatch",
				"order_payment_metadata_incomplete",
				"order_refund_ledger_mismatch",
				"uncredited_order_has_credit",
				"uncredited_order_has_credited_event",
			],
		)
	})

	it("flags persisted paid orders and incomplete refunds", () => {
		const report = analyzePaymentAccounting(
			[],
			[
				order({
					id: "paid-order",
					state: "paid",
					creditLedgerCount: 0,
					creditLedgerMicros: 0n,
					creditedEventCount: 0,
				}),
				order({
					id: "refunded-order",
					state: "refunded",
					providerRefundNo: null,
					refundedAt: null,
					refundLedgerCount: 0,
					refundLedgerMicros: 0n,
				}),
			],
			checkedAt,
		)

		assert.deepEqual(
			report.findings.map((finding) => finding.code),
			[
				"paid_order_not_credited",
				"order_refund_ledger_mismatch",
				"order_refund_metadata_incomplete",
			],
		)
	})
})
