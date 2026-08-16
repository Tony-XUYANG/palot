/**
 * Payment-domain types shared by the gateway repository and provider adapters.
 */

export type PaymentChannel = "alipay" | "sandbox"
export type PaymentOrderState =
	| "pending"
	| "paid"
	| "credited"
	| "closed"
	| "refunding"
	| "refunded"
	| "failed"

export interface TopupPackage {
	id: string
	label: string
	amountMicros: bigint
	creditMicros: bigint
	sortOrder: number
}

export interface PaymentOrder {
	id: string
	accountId: string
	packageId: string
	channel: PaymentChannel
	state: PaymentOrderState
	amountMicros: bigint
	creditMicros: bigint
	providerTradeNo: string | null
	providerRefundNo: string | null
	createdAt: string
	expiresAt: string
	paidAt: string | null
	creditedAt: string | null
	refundedAt: string | null
}

export interface CheckoutOrder extends PaymentOrder {
	checkoutTokenHash: string
}

export interface PaymentNotification {
	providerEventId: string
	providerTradeNo: string
	orderId: string
	amountMicros: bigint
	payloadHash: string
}

export interface PaymentProvider {
	readonly channel: PaymentChannel
	createCheckoutUrl(order: PaymentOrder): Promise<string>
	verifyNotification(parameters: Record<string, string>): PaymentNotification
	queryPayment(order: PaymentOrder): Promise<PaymentNotification | null>
	refund(order: PaymentOrder): Promise<{ providerRefundNo: string }>
}
