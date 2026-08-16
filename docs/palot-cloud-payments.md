# Palot Cloud Payments

Palot Cloud sells non-transferable AI service credits for DeepSeek and GLM. Codex and OpenAI remain
BYOK and are not funded by these credits. Payments are disabled unless the gateway is explicitly
configured for `sandbox` or `alipay` mode.

## Money and credit flow

1. The authenticated desktop client requests one of the fixed CNY 10, CNY 30, or CNY 100 packages.
2. The gateway creates a 15-minute order and returns a tokenized HTTPS checkout URL.
3. The system browser opens the Palot checkout. The desktop return path can only read order state.
4. A verified provider notification credits the account in the same PostgreSQL transaction that
   records the payment event and ledger entry.
5. Alipay settles merchant funds to the account configured in the merchant portal. Palot never
   receives or stores customer card details.

Repeated notifications, checkout reloads, and client retries do not issue duplicate credit. A
verified payment received after an order closes is still credited so Palot never retains a completed
payment without providing the purchased service.

The gateway queries unresolved Alipay orders every five minutes for 24 hours, recovering successful
payments whose callback was lost. Operators can run `bun run admin topup:reconcile` for an immediate
bounded query.

An internal accounting audit runs at startup and every 24 hours. It compares every account balance
with its append-only ledger, then checks payment credit entries, credited payment events, payment
metadata, refund reservations, and refund metadata. A failed audit hides payment availability and
rejects new order creation, while callbacks and checkout completion for existing orders remain
enabled so a customer who already paid can still receive credit. Run the same gate manually:

```text
bun run admin topup:audit
```

The command emits a structured report and exits with code 2 when findings exist. Provider
settlement-statement reconciliation remains a live merchant acceptance gate.

## Environment modes

- `disabled`: production default. Package discovery remains visible to authenticated clients but
  order creation returns an unavailable response.
- `sandbox`: renders a local Palot completion button and never contacts a payment provider. Use only
  for engineering acceptance on a dedicated non-production gateway.
- `alipay`: signs computer website checkout and refund requests with RSA2 and accepts only verified
  callbacks matching the configured application and seller identifiers.

Alipay material must be stored in the `palot-cloud-gateway-credentials` Sealos Secret. Use
`scripts/set-palot-cloud-alipay-secrets.ps1` to read PEM files locally and update the Secret over
stdin. Change `PALOT_PAYMENT_MODE` only after the merchant application, settlement account, public
terms, privacy notice, sandbox callback, refund, and reconciliation checks are accepted.

## Refund operations

During the beta, refunds are operator initiated:

```text
bun run admin topup:refund <order-id>
```

The command first reserves the unspent purchased credit, then requests an idempotent original-route
refund. A provider failure leaves the order in `refunding`, allowing the same command to retry safely.
If the account has already consumed any part of the package, the refund is rejected for manual
review.

## Release gates

- No merchant private key, callback body, payer identity, model credential, or Palot token in logs,
  source, images, desktop packages, or workflow artifacts.
- Forged, mismatched, duplicate, delayed, and out-of-order notifications covered by automated tests.
- CNY 0.01-CNY 1.00 live payment, credit, refund, and settlement statement checked before beta sales.
- Daily order, ledger, provider, and settlement reconciliation has zero unexplained difference.
- `topup:audit` reports zero internal accounting findings before and after each payment test.
- Payment credit latency is below 10 seconds for at least 99% of accepted callbacks.
