# payments-service

A small payment service that accepts provider webhooks, settles charges, and
records the settled amount in an internal ledger.

## Layout

- `src/webhooks/payment.ts` — HTTP entry point for provider webhook deliveries.
- `src/payments/provider.ts` — client for the downstream payment provider.
- `src/payments/ledger.ts` — in-memory settlement ledger.

## Operations

See `docs/runbooks/payments-webhooks.md` for the webhook incident runbook.
