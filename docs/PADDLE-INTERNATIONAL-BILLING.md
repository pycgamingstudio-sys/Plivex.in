# Paddle international billing

India subscriptions continue to use Cashfree. Non-India workspaces use Paddle Billing when their country-specific recurring Price ID is configured.

## Supabase Edge Function secrets

- `PADDLE_API_KEY`: Paddle Billing API key (server-only).
- `PADDLE_ENV`: `sandbox` until sandbox tests pass; set `production` only for live billing.
- `VITE_PADDLE_CLIENT_TOKEN`: Paddle client-side token in the frontend build environment (public token; never use the API key here).
- `VITE_PADDLE_ENV`: match `PADDLE_ENV` (`sandbox` or `production`).
- `APP_BASE_URL`: approved Plivex checkout domain, normally `https://plivex.in`.
- `PADDLE_WEBHOOK_SECRET`: endpoint-specific secret from the Paddle notification destination.
- `PADDLE_PRICE_ID_US_BASIC_MONTHLY`, `PADDLE_PRICE_ID_US_PRO_MONTHLY`
- `PADDLE_PRICE_ID_GB_BASIC_MONTHLY`, `PADDLE_PRICE_ID_GB_PRO_MONTHLY`
- `PADDLE_PRICE_ID_CA_BASIC_MONTHLY`, `PADDLE_PRICE_ID_CA_PRO_MONTHLY`
- `PADDLE_PRICE_ID_AU_BASIC_MONTHLY`, `PADDLE_PRICE_ID_AU_PRO_MONTHLY`
- `PADDLE_PRICE_ID_SG_BASIC_MONTHLY`, `PADDLE_PRICE_ID_SG_PRO_MONTHLY`

AE is intentionally marked payment-disabled in the current country billing config; its Paddle checkout button remains disabled. Enable it only after the AED plan and provider setup have been reviewed. Each configured Price ID must be a recurring Paddle Price in that country's Workspace currency. The backend compares the Paddle transaction currency and subtotal with Plivex's configured country price before it returns a checkout link. Australian plan amounts must match the pre-existing Plivex pricing configuration in `src/global/billing/pricing.js`; never derive prices from examples.

## Checkout return page

Paddle returns customers to `/payment-result?_ptxn=...`. That page loads Paddle.js, opens the transaction using the public client token, and waits for the signed webhook before showing the subscription as active. The frontend token and environment must match the server-side `PADDLE_ENV`.

## Paddle dashboard checkout settings

Set the default payment link to `https://plivex.in/payment-result` and approve the `plivex.in` domain in Paddle Website approval. Sandbox and live environments have separate approval/configuration. The API uses this same approved URL as the transaction checkout link.

## Webhook destination

`https://sqzpaiibmfsvarrkwkvb.supabase.co/functions/v1/paddle-webhook`

Subscribe to `transaction.completed` and `subscription.canceled`. Signature verification uses the raw request body and the endpoint-specific `PADDLE_WEBHOOK_SECRET`. Access is activated only after a verified completed transaction is applied to the subscription ledger.

## Notes

Paddle checkout stays unavailable (without blocking the app) until the API key, webhook secret, public client token, matching environment, approved checkout domain, and relevant country/plan Price IDs are present. Never put Paddle API keys or webhook secrets in browser code.
