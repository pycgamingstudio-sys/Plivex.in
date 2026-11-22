# Paddle international billing

India subscriptions continue to use Cashfree. Non-India workspaces use Paddle Billing when their country-specific recurring Price ID is configured.

## Supabase Edge Function secrets

- `PADDLE_API_KEY`: Paddle Billing API key (server-only).
- `PADDLE_ENV`: `sandbox` until sandbox tests pass; set `production` only for live billing.
- `PADDLE_WEBHOOK_SECRET`: endpoint-specific secret from the Paddle notification destination.
- `PADDLE_PRICE_ID_US_BASIC_MONTHLY`, `PADDLE_PRICE_ID_US_PRO_MONTHLY`
- `PADDLE_PRICE_ID_GB_BASIC_MONTHLY`, `PADDLE_PRICE_ID_GB_PRO_MONTHLY`
- `PADDLE_PRICE_ID_AE_BASIC_MONTHLY`, `PADDLE_PRICE_ID_AE_PRO_MONTHLY`
- `PADDLE_PRICE_ID_CA_BASIC_MONTHLY`, `PADDLE_PRICE_ID_CA_PRO_MONTHLY`
- `PADDLE_PRICE_ID_AU_BASIC_MONTHLY`, `PADDLE_PRICE_ID_AU_PRO_MONTHLY`
- `PADDLE_PRICE_ID_SG_BASIC_MONTHLY`, `PADDLE_PRICE_ID_SG_PRO_MONTHLY`

Each Price ID must be a recurring Paddle Price in that country's Workspace currency. The backend compares the Paddle transaction currency and subtotal with Plivex's configured country price before it returns a checkout link. The Australian Basic monthly price is configured as AUD 799.00.

## Webhook destination

`https://sqzpaiibmfsvarrkwkvb.supabase.co/functions/v1/paddle-webhook`

Subscribe to `transaction.completed` and `subscription.canceled`. Signature verification uses the raw request body and the endpoint-specific `PADDLE_WEBHOOK_SECRET`. Access is activated only after a verified completed transaction is applied to the subscription ledger.

## Notes

Paddle checkout stays unavailable (without blocking the app) until the API key, webhook secret, and relevant country/plan Price IDs are present. Never put Paddle API keys or webhook secrets in browser code.
