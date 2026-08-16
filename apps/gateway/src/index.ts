/**
 * Palot Cloud gateway process entrypoint.
 */

import { createGatewayApp } from "./app"
import { readGatewayConfig } from "./config"
import { createPaymentProvider } from "./payment-provider"
import { PostgresGatewayRepository } from "./postgres-repository"

const config = readGatewayConfig()
const repository = new PostgresGatewayRepository(config.databaseUrl, config.tokenPepper)
await repository.migrate()
const paymentProvider = createPaymentProvider(config)
let paymentAccountingHealthy = false

const auditPaymentAccounting = async () => {
	try {
		const report = await repository.auditPaymentAccounting()
		paymentAccountingHealthy = report.ok
		if (report.ok) {
			console.log(
				`Payment accounting audit passed (${report.accountsChecked} accounts, ${report.ordersChecked} orders)`,
			)
			return
		}
		const findingCounts = Object.fromEntries(
			[...new Set(report.findings.map((finding) => finding.code))].map((code) => [
				code,
				report.findings.filter((finding) => finding.code === code).length,
			]),
		)
		console.error("Payment accounting audit found inconsistencies; new top-ups are disabled", {
			findingCount: report.findings.length,
			findingCounts,
		})
	} catch (error) {
		paymentAccountingHealthy = false
		console.error("Could not audit payment accounting; new top-ups are disabled", {
			name: error instanceof Error ? error.name : "UnknownError",
		})
	}
}

await auditPaymentAccounting()
const paymentAuditTimer = setInterval(auditPaymentAccounting, 24 * 60 * 60_000)
paymentAuditTimer.unref()

const recoverExpiredReservations = async () => {
	try {
		const cutoff = new Date(Date.now() - config.reservationTtlMs)
		const refunded = await repository.refundExpiredReservations(cutoff)
		if (refunded > 0) console.log(`Refunded ${refunded} expired request reservation(s)`)
		const closedOrders = await repository.closeExpiredTopupOrders(new Date())
		if (closedOrders > 0) console.log(`Closed ${closedOrders} expired top-up order(s)`)
	} catch (error) {
		console.error("Could not recover expired request reservations", {
			name: error instanceof Error ? error.name : "UnknownError",
		})
	}
}

await recoverExpiredReservations()
const recoveryTimer = setInterval(recoverExpiredReservations, 60_000)
recoveryTimer.unref()

const reconcilePayments = async () => {
	if (!paymentProvider) return
	try {
		const orders = await repository.listTopupOrdersForReconciliation(
			new Date(Date.now() - 24 * 60 * 60 * 1_000),
			100,
		)
		let credited = 0
		for (const order of orders) {
			const notification = await paymentProvider.queryPayment(order)
			if (!notification) continue
			const result = await repository.completeTopupPayment({
				...notification,
				channel: paymentProvider.channel,
			})
			if (result.credited) credited++
		}
		if (credited > 0) console.log(`Reconciled ${credited} top-up payment(s)`)
	} catch (error) {
		console.error("Could not reconcile top-up payments", {
			name: error instanceof Error ? error.name : "UnknownError",
		})
	}
}

const reconciliationTimer = setInterval(reconcilePayments, 5 * 60_000)
reconciliationTimer.unref()

const app = createGatewayApp({
	repository,
	config,
	paymentProvider,
	paymentAccountingHealthy: () => paymentAccountingHealthy,
})

let closing = false
const close = async () => {
	if (closing) return
	closing = true
	clearInterval(recoveryTimer)
	clearInterval(reconciliationTimer)
	clearInterval(paymentAuditTimer)
	await repository.close()
	process.exit(0)
}

process.on("SIGINT", close)
process.on("SIGTERM", close)

console.log(`Palot Cloud gateway listening on port ${config.port}`)

export default {
	port: config.port,
	fetch: app.fetch,
}
