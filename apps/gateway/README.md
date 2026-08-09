# Palot Cloud Gateway

Palot Cloud is an optional prepaid model gateway. The desktop BYOK paths remain free and do not
depend on this service. The first managed models route to the official DeepSeek and Zhipu AI APIs.
Codex remains BYOK.

The access token is a revocable credential, not stored value. Balances, reservations, settlements,
refunds, price versions, and manual credits live in PostgreSQL. Upstream API keys are read only from
server environment variables. Request prompts, code, model responses, authorization headers, and
upstream credentials are not written to the database or application logs.

## Local development

1. Copy `.env.example` to an ignored `.env` and replace the placeholders.
2. Start PostgreSQL and set `DATABASE_URL` to that database.
3. Run `bun run dev` from this directory. The idempotent schema migration runs at startup.
4. Use `bun run admin -- <command>` for manual account, token, credit, and price operations. Every
   manual credit requires an external payment reference; retrying the same reference is idempotent.

Price inputs are the current official upstream CNY rates per one million tokens. The admin command
applies `PALOT_MARKUP_BASIS_POINTS` (30% by default) and stores the resulting retail price. Set each
price explicitly before a model is exposed:

```text
bun run admin -- price:set palot-deepseek-chat <input> <output> <cache-read>
bun run admin -- price:set palot-glm-coding <input> <output> <cache-read>
```

The operator must review the official upstream price before every update. No stale model price is
embedded in the application.

## HTTP surface

- `GET /health` checks database availability without authentication.
- `GET /v1/models` lists only configured providers with an active price.
- `GET /v1/account` returns the authenticated balance and recent sanitized usage.
- `POST /v1/chat/completions` accepts OpenAI-compatible streaming and non-streaming requests.

All `/v1` routes require `Authorization: Bearer <Palot token>`. The optional `Idempotency-Key` header
prevents duplicate charging. Monetary values are serialized as integer micro-yuan strings.

## Sealos credentials

The deployment template never accepts or contains upstream provider keys. Before deploying, run
`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/set-palot-cloud-sealos-secrets.ps1 -UseGui`
from the repository root. It reads the DeepSeek and Zhipu AI keys through masked, paste-friendly
fields and sends a Secret manifest directly to `kubectl` over stdin. The values are not written to
the project, command line, or deployment log. Re-running the script updates the provider keys while
preserving the existing token pepper. Omit `-UseGui` for hidden terminal prompts.
