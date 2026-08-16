/**
 * Manual Palot Cloud account, credit, token, and price administration CLI.
 */

import { readGatewayConfig } from "./config"
import { resolvePalotCloudModel } from "./models"
import { createPaymentProvider } from "./payment-provider"
import { PostgresGatewayRepository } from "./postgres-repository"
import { applyMarkup, formatMicrosAsYuan, parseYuanToMicros } from "./pricing"

function usage(): never {
	throw new Error(
		[
			"Usage:",
			"  bun run admin account:create <name>",
			"  bun run admin token:create <account-id>",
			"  bun run admin token:revoke <token-prefix>",
			"  bun run admin credit:grant <account-id> <yuan> <reference> <reason>",
			"  bun run admin account:freeze <account-id>",
			"  bun run admin account:activate <account-id>",
			"  bun run admin price:set <model-id> <input-yuan> <output-yuan> <cache-yuan>",
			"  bun run admin topup:refund <order-id>",
			"  bun run admin topup:reconcile",
		].join("\n"),
	)
}

const config = readGatewayConfig()
const repository = new PostgresGatewayRepository(config.databaseUrl, config.tokenPepper)

try {
	await repository.migrate()
	const [command, ...args] = process.argv.slice(2)
	switch (command) {
		case "account:create": {
			const name = args.join(" ").trim()
			if (!name) usage()
			const account = await repository.createAccount(name)
			console.log(`Account created: ${account.id} (${account.name})`)
			break
		}
		case "token:create": {
			const accountId = args[0]
			if (!accountId) usage()
			const token = await repository.createToken(accountId)
			console.log(`Token prefix: ${token.tokenPrefix}`)
			console.log("This token is shown once. Store it in the user's Palot client:")
			console.log(token.rawToken)
			break
		}
		case "token:revoke": {
			const tokenPrefix = args[0]
			if (!tokenPrefix) usage()
			const revoked = await repository.revokeToken(tokenPrefix)
			if (!revoked) throw new Error("Active token prefix not found")
			console.log(`Token ${tokenPrefix} revoked`)
			break
		}
		case "credit:grant": {
			const [accountId, yuan, reference, ...reasonParts] = args
			const reason = reasonParts.join(" ").trim()
			if (!accountId || !yuan || !reference || !reason) usage()
			if (!/^[A-Za-z0-9._:-]{1,100}$/.test(reference)) {
				throw new Error(
					"Credit reference must use 1-100 letters, digits, dot, underscore, colon, or dash",
				)
			}
			const amountMicros = parseYuanToMicros(yuan)
			const account = await repository.grantCredit({
				accountId,
				amountMicros,
				idempotencyKey: `manual-credit:${reference}`,
				reason,
			})
			console.log(`Credit granted. Balance: CNY ${formatMicrosAsYuan(account.balanceMicros)}`)
			break
		}
		case "account:freeze":
		case "account:activate": {
			const accountId = args[0]
			if (!accountId) usage()
			const state = command === "account:freeze" ? "frozen" : "active"
			const account = await repository.setAccountState(accountId, state)
			console.log(`Account ${account.id} is now ${account.state}`)
			break
		}
		case "price:set": {
			const [modelId, inputYuan, outputYuan, cacheYuan] = args
			if (!modelId || !inputYuan || !outputYuan || !cacheYuan) usage()
			if (!resolvePalotCloudModel(modelId)) throw new Error("Unknown Palot Cloud model")
			const price = await repository.setPrice({
				modelId,
				inputMicrosPerMillion: applyMarkup(parseYuanToMicros(inputYuan), config.markupBasisPoints),
				outputMicrosPerMillion: applyMarkup(
					parseYuanToMicros(outputYuan),
					config.markupBasisPoints,
				),
				cacheReadMicrosPerMillion: applyMarkup(
					parseYuanToMicros(cacheYuan),
					config.markupBasisPoints,
				),
			})
			console.log(
				`Price ${price.modelId} version ${price.version} activated with ${config.markupBasisPoints} bps markup`,
			)
			break
		}
		case "topup:refund": {
			const orderId = args[0]
			if (!orderId) usage()
			const provider = createPaymentProvider(config)
			if (!provider) throw new Error("Payments are disabled")
			const order = await repository.prepareTopupRefund(orderId)
			if (order.channel !== provider.channel) {
				throw new Error("The configured payment provider does not match this order")
			}
			if (order.state === "refunded") {
				console.log(`Top-up order ${order.id} was already refunded`)
				break
			}
			const refund = await provider.refund(order)
			const completed = await repository.completeTopupRefund(order.id, refund.providerRefundNo)
			console.log(`Top-up order ${completed.id} refunded through ${completed.channel}`)
			break
		}
		case "topup:reconcile": {
			const provider = createPaymentProvider(config)
			if (!provider) throw new Error("Payments are disabled")
			const orders = await repository.listTopupOrdersForReconciliation(
				new Date(Date.now() - 24 * 60 * 60 * 1_000),
				500,
			)
			let credited = 0
			for (const order of orders) {
				const notification = await provider.queryPayment(order)
				if (!notification) continue
				const result = await repository.completeTopupPayment({
					...notification,
					channel: provider.channel,
				})
				if (result.credited) credited++
			}
			console.log(`Reconciliation checked ${orders.length} order(s) and credited ${credited}`)
			break
		}
		default:
			usage()
	}
} finally {
	await repository.close()
}
