import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { MemoryGatewayRepository } from "./memory-repository"
import { InsufficientBalanceError } from "./repository"

describe("Palot Cloud in-memory billing repository", () => {
	it("authenticates opaque tokens and applies manual credits idempotently", async () => {
		const repository = new MemoryGatewayRepository("p".repeat(32))
		const account = await repository.createAccount("Beta user")
		const token = await repository.createToken(account.id)
		const first = await repository.grantCredit({
			accountId: account.id,
			amountMicros: 10_000_000n,
			idempotencyKey: "manual-credit-1",
			reason: "Beta pack",
		})
		const second = await repository.grantCredit({
			accountId: account.id,
			amountMicros: 10_000_000n,
			idempotencyKey: "manual-credit-1",
			reason: "Retried beta pack",
		})

		assert.equal(first.balanceMicros, 10_000_000n)
		assert.equal(second.balanceMicros, 10_000_000n)
		assert.equal((await repository.authenticate(token.rawToken))?.id, account.id)
		assert.equal(await repository.revokeToken(token.tokenPrefix), true)
		assert.equal(await repository.authenticate(token.rawToken), null)
		assert.equal(await repository.revokeToken(token.tokenPrefix), false)
		assert.equal(await repository.authenticate("palot_live_000000000000_invalid"), null)
	})

	it("prevents concurrent overspend and settles unused reservations", async () => {
		const repository = new MemoryGatewayRepository("p".repeat(32))
		const account = await repository.createAccount("Concurrent user")
		await repository.grantCredit({
			accountId: account.id,
			amountMicros: 100n,
			idempotencyKey: "credit",
			reason: "Test",
		})
		const attempts = await Promise.allSettled([
			repository.reserve({
				accountId: account.id,
				idempotencyKey: "request-1",
				modelId: "palot-deepseek-chat",
				priceVersion: 1,
				reservedMicros: 60n,
			}),
			repository.reserve({
				accountId: account.id,
				idempotencyKey: "request-2",
				modelId: "palot-deepseek-chat",
				priceVersion: 1,
				reservedMicros: 60n,
			}),
		])
		assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1)
		const failure = attempts.find((attempt) => attempt.status === "rejected")
		assert.ok(failure && failure.reason instanceof InsufficientBalanceError)

		const reservation = attempts.find((attempt) => attempt.status === "fulfilled")
		assert.ok(reservation?.status === "fulfilled")
		const settled = await repository.settle({
			usageId: reservation.value.usage.id,
			chargedMicros: 25n,
			usage: {
				inputTokens: 10,
				outputTokens: 5,
				cacheReadTokens: 0,
				source: "provider",
			},
		})
		assert.equal(settled.balanceMicros, 75n)
		assert.equal(settled.usage.chargedMicros, 25n)
	})

	it("returns duplicate reservations without charging twice and refunds once", async () => {
		const repository = new MemoryGatewayRepository("p".repeat(32))
		const account = await repository.createAccount("Retry user")
		await repository.grantCredit({
			accountId: account.id,
			amountMicros: 1_000n,
			idempotencyKey: "credit",
			reason: "Test",
		})
		const input = {
			accountId: account.id,
			idempotencyKey: "same-request",
			modelId: "palot-deepseek-chat",
			priceVersion: 1,
			reservedMicros: 400n,
		}
		const first = await repository.reserve(input)
		const duplicate = await repository.reserve(input)
		assert.equal(first.created, true)
		assert.equal(duplicate.created, false)
		assert.equal(duplicate.balanceMicros, 600n)
		assert.equal((await repository.refund(first.usage.id, "Failed")).balanceMicros, 1_000n)
		assert.equal((await repository.refund(first.usage.id, "Retried")).balanceMicros, 1_000n)
	})

	it("recovers expired reservations exactly once", async () => {
		let now = new Date("2026-08-16T00:00:00.000Z")
		const repository = new MemoryGatewayRepository("p".repeat(32), () => now)
		const account = await repository.createAccount("Recovery user")
		await repository.grantCredit({
			accountId: account.id,
			amountMicros: 1_000n,
			idempotencyKey: "credit",
			reason: "Test",
		})
		await repository.reserve({
			accountId: account.id,
			idempotencyKey: "expired-request",
			modelId: "palot-deepseek-chat",
			priceVersion: 1,
			reservedMicros: 400n,
		})

		now = new Date("2026-08-16T00:16:00.000Z")
		assert.equal(
			await repository.refundExpiredReservations(new Date("2026-08-16T00:01:00.000Z")),
			1,
		)
		assert.equal(
			await repository.refundExpiredReservations(new Date("2026-08-16T00:01:00.000Z")),
			0,
		)
		const summary = await repository.getAccountSummary(account.id)
		assert.equal(summary?.balanceMicros, 1_000n)
		assert.equal(summary?.recentUsage[0]?.state, "refunded")
	})

	it("credits payment notifications idempotently and reserves refunds", async () => {
		const repository = new MemoryGatewayRepository("p".repeat(32))
		const account = await repository.createAccount("Payment user")
		const created = await repository.createTopupOrder({
			accountId: account.id,
			packageId: "credits-30",
			channel: "sandbox",
			idempotencyKey: "payment-1",
			checkoutTokenHash: "a".repeat(64),
			expiresAt: new Date(Date.now() + 60_000),
		})
		const notification = {
			channel: "sandbox" as const,
			orderId: created.order.id,
			amountMicros: 30_000_000n,
			providerEventId: "event-1",
			providerTradeNo: "trade-1",
			payloadHash: "b".repeat(64),
		}
		assert.equal((await repository.completeTopupPayment(notification)).credited, true)
		assert.equal((await repository.completeTopupPayment(notification)).credited, false)
		assert.equal((await repository.getAccountSummary(account.id))?.balanceMicros, 30_000_000n)
		assert.equal((await repository.prepareTopupRefund(created.order.id)).state, "refunding")
		assert.equal((await repository.getAccountSummary(account.id))?.balanceMicros, 0n)
		assert.equal(
			(await repository.completeTopupRefund(created.order.id, "sandbox-refund-1")).state,
			"refunded",
		)
	})

	it("lists only recent unresolved orders for reconciliation", async () => {
		let now = new Date("2026-08-16T00:00:00.000Z")
		const repository = new MemoryGatewayRepository("p".repeat(32), () => now)
		const account = await repository.createAccount("Reconciliation user")
		const pending = await repository.createTopupOrder({
			accountId: account.id,
			packageId: "credits-10",
			channel: "sandbox",
			idempotencyKey: "pending",
			checkoutTokenHash: "a".repeat(64),
			expiresAt: new Date("2026-08-16T00:15:00.000Z"),
		})
		now = new Date("2026-08-16T00:20:00.000Z")
		await repository.closeExpiredTopupOrders(now)
		const orders = await repository.listTopupOrdersForReconciliation(
			new Date("2026-08-15T00:00:00.000Z"),
			10,
		)
		assert.deepEqual(
			orders.map((order) => order.id),
			[pending.order.id],
		)
	})
})
