CREATE TABLE IF NOT EXISTS accounts (
	id UUID PRIMARY KEY,
	name TEXT NOT NULL,
	state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'frozen')),
	balance_micros BIGINT NOT NULL DEFAULT 0 CHECK (balance_micros >= 0),
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS access_tokens (
	id UUID PRIMARY KEY,
	account_id UUID NOT NULL REFERENCES accounts(id),
	token_prefix TEXT NOT NULL UNIQUE,
	token_hash CHAR(64) NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	last_used_at TIMESTAMPTZ,
	revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS model_prices (
	id UUID PRIMARY KEY,
	model_id TEXT NOT NULL,
	version INTEGER NOT NULL CHECK (version > 0),
	input_micros_per_million BIGINT NOT NULL CHECK (input_micros_per_million >= 0),
	output_micros_per_million BIGINT NOT NULL CHECK (output_micros_per_million >= 0),
	cache_read_micros_per_million BIGINT NOT NULL CHECK (cache_read_micros_per_million >= 0),
	active BOOLEAN NOT NULL DEFAULT TRUE,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	UNIQUE (model_id, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS model_prices_one_active_per_model
	ON model_prices (model_id) WHERE active;

CREATE TABLE IF NOT EXISTS usage_records (
	id UUID PRIMARY KEY,
	account_id UUID NOT NULL REFERENCES accounts(id),
	idempotency_key TEXT NOT NULL,
	model_id TEXT NOT NULL,
	price_version INTEGER NOT NULL CHECK (price_version > 0),
	state TEXT NOT NULL CHECK (state IN ('reserved', 'settled', 'refunded')),
	reserved_micros BIGINT NOT NULL CHECK (reserved_micros > 0),
	charged_micros BIGINT NOT NULL DEFAULT 0 CHECK (charged_micros >= 0),
	input_tokens INTEGER,
	output_tokens INTEGER,
	cache_read_tokens INTEGER,
	usage_source TEXT CHECK (usage_source IN ('provider', 'estimated')),
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	settled_at TIMESTAMPTZ,
	UNIQUE (account_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS usage_records_account_created
	ON usage_records (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ledger_entries (
	id BIGSERIAL PRIMARY KEY,
	account_id UUID NOT NULL REFERENCES accounts(id),
	usage_id UUID REFERENCES usage_records(id),
	kind TEXT NOT NULL CHECK (kind IN ('credit', 'reserve', 'settlement', 'refund', 'adjustment')),
	amount_micros BIGINT NOT NULL,
	balance_after_micros BIGINT NOT NULL CHECK (balance_after_micros >= 0),
	idempotency_key TEXT NOT NULL UNIQUE,
	reason TEXT NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ledger_entries_account_created
	ON ledger_entries (account_id, created_at DESC);
