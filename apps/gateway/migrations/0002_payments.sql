CREATE TABLE IF NOT EXISTS topup_packages (
	id TEXT PRIMARY KEY,
	label TEXT NOT NULL,
	amount_micros BIGINT NOT NULL CHECK (amount_micros > 0),
	credit_micros BIGINT NOT NULL CHECK (credit_micros > 0),
	sort_order INTEGER NOT NULL,
	active BOOLEAN NOT NULL DEFAULT TRUE,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO topup_packages (id, label, amount_micros, credit_micros, sort_order)
VALUES
	('credits-10', 'CNY 10', 10000000, 10000000, 10),
	('credits-30', 'CNY 30', 30000000, 30000000, 20),
	('credits-100', 'CNY 100', 100000000, 100000000, 30)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS payment_orders (
	id UUID PRIMARY KEY,
	account_id UUID NOT NULL REFERENCES accounts(id),
	package_id TEXT NOT NULL REFERENCES topup_packages(id),
	channel TEXT NOT NULL CHECK (channel IN ('alipay', 'sandbox')),
	state TEXT NOT NULL CHECK (state IN ('pending', 'paid', 'credited', 'closed', 'refunding', 'refunded', 'failed')),
	amount_micros BIGINT NOT NULL CHECK (amount_micros > 0),
	credit_micros BIGINT NOT NULL CHECK (credit_micros > 0),
	idempotency_key TEXT NOT NULL,
	checkout_token_hash CHAR(64) NOT NULL,
	provider_trade_no TEXT UNIQUE,
	provider_refund_no TEXT UNIQUE,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	expires_at TIMESTAMPTZ NOT NULL,
	paid_at TIMESTAMPTZ,
	credited_at TIMESTAMPTZ,
	refunded_at TIMESTAMPTZ,
	UNIQUE (account_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS payment_orders_account_created
	ON payment_orders (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS payment_orders_pending_expiry
	ON payment_orders (expires_at) WHERE state = 'pending';

CREATE TABLE IF NOT EXISTS payment_events (
	id BIGSERIAL PRIMARY KEY,
	channel TEXT NOT NULL CHECK (channel IN ('alipay', 'sandbox')),
	provider_event_id TEXT NOT NULL,
	provider_trade_no TEXT NOT NULL,
	order_id UUID NOT NULL REFERENCES payment_orders(id),
	payload_hash CHAR(64) NOT NULL,
	result TEXT NOT NULL CHECK (result IN ('credited', 'duplicate')),
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	UNIQUE (channel, provider_event_id)
);
