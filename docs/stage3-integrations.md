# Stage 3 integration setup and operational boundaries

This guide describes the non-deployed Stage 3 integration foundation. It does not mean a provider is live-connected.

## Provider status meanings

- **Available** — Plivex's internal capability is available; no external provider connection is implied.
- **Setup required** — the workspace owner must configure the provider.
- **Awaiting provider access** — code and setup boundaries exist, but a provider-owned account, credential or approval is still required.
- **Sandbox tested** — the documented provider sandbox contract has passed with test credentials.
- **Live verified** — a real provider check has succeeded and a verification timestamp is recorded.

Do not change an integration to Live verified manually.

## Shopify inbound webhooks

The current Shopify adapter is an inbound, signed webhook receiver. It is not a general Shopify Admin API client and does not claim to sync products or orders in both directions.

1. Create a Shopify webhook subscription in the Main Workspace integration centre.
2. Configure the Shopify app's client secret as a Supabase Edge Function secret named `SHOPIFY_API_SECRET`.
3. Never place this secret in a browser, Vite environment variable, Git commit, URL or support chat.
4. Configure Shopify to send the selected topics to the endpoint shown by Plivex.
5. Send a test event and verify that it appears in the webhook event log before treating the connection as sandbox tested.

Shopify signs webhook bodies with the app-level client secret. Plivex therefore verifies Shopify HMAC with `SHOPIFY_API_SECRET`; it does not use the per-subscription custom-webhook secret for Shopify.

Supported inbound topics:
- `orders/create`
- `orders/updated`
- `products/create`
- `products/update`
- `inventory_levels/update`

If the secret is missing, the endpoint fails closed with `SHOPIFY_PROVIDER_SECRET_NOT_CONFIGURED`.

## Custom signed inbound webhooks

1. Create a Custom webhook subscription.
2. Copy the signing secret once and store it in your own trusted server-side secret manager.
3. Sign the exact raw request body using HMAC-SHA256 over `timestamp.eventId.rawBody`.
4. Send:
   - `x-plivex-timestamp`: Unix timestamp in seconds
   - `x-plivex-event-id`: stable provider event ID
   - `x-plivex-event-type`: one subscribed event type
   - `x-plivex-signature`: `sha256={hex_digest}`
5. Timestamps outside the five-minute acceptance window are rejected. Repeated event IDs are deduplicated per subscription.

Supported custom event types:
- `invoice.created`
- `invoice.status_changed`
- `lead.created`
- `lead.stage_changed`
- `expense.created`
- `stock.low_stock`

Verified receipts are queued for internal event processing. Retry attempts use bounded exponential backoff and stop after 12 attempts; failed receipts become visible dead letters. An authorized admin/manager can manually replay a dead-letter event. Replaying does not bypass signature verification for new inbound requests.

## Public API v1

See [Public API v1](./public-api-v1.md) for endpoint, authentication, scope, pagination, idempotency, error and key-rotation contracts.

Only the documented CRM lead-create operation is write-enabled. Do not assume invoice, payment, accounting, supplier or stock writes are exposed.

## External owner actions and current limits

| Provider | Owner action still required | Current boundary |
|---|---|---|
| Shopify | Create/own the Shopify app and configure `SHOPIFY_API_SECRET` in Supabase Edge Function secrets; register the inbound webhook topics | Signed inbound webhook receiver only; Admin API sync and outbound delivery are not claimed |
| Custom webhooks | Store the one-time signing secret in the caller's server-side secret manager and configure the endpoint | Signed inbound events only |
| WhatsApp Cloud | Supply a Meta business/app, approved phone number and server-side credentials before sandbox/live checks | Existing send workflow remains separate; no live status is implied by the Stage 3 registry |
| Cashfree | Owner-controlled provider account and sandbox credentials | Awaiting provider access; no live payment activation |
| Paddle | Owner-controlled seller account, verification and sandbox credentials | Awaiting provider access; no live billing activation |

Never paste provider secrets into chat. Use the Supabase project secret-management flow.

## Non-deployment guarantee

Stage 3 changes are intended for a review branch and disposable CI databases only. No production migration, production deployment, live provider activation, customer message or payment capture is authorized by this work.
