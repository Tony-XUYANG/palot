/**
 * Payment-provider construction with production payments disabled by default.
 */

import { AlipayProvider } from "./alipay"
import type { GatewayConfig } from "./config"
import type { PaymentNotification, PaymentOrder, PaymentProvider } from "./payments"

class SandboxPaymentProvider implements PaymentProvider {
	readonly channel = "sandbox" as const

	async createCheckoutUrl(_order: PaymentOrder): Promise<string> {
		throw new Error("Sandbox checkout is rendered by Palot Cloud")
	}

	verifyNotification(_parameters: Record<string, string>): PaymentNotification {
		throw new Error("Sandbox payments do not accept external notifications")
	}

	async queryPayment(_order: PaymentOrder): Promise<PaymentNotification | null> {
		return null
	}

	async refund(order: PaymentOrder): Promise<{ providerRefundNo: string }> {
		return { providerRefundNo: `sandbox-refund-${order.id}` }
	}
}

export function createPaymentProvider(config: GatewayConfig): PaymentProvider | null {
	if (config.paymentMode === "disabled") return null
	if (config.paymentMode === "sandbox") return new SandboxPaymentProvider()
	if (!config.alipay) throw new Error("Alipay configuration is unavailable")
	return new AlipayProvider(config.alipay)
}
