# Plivex Global Payments & Subscriptions (Part 3)

## Billing source of truth

- Country pricing is defined once in `src/global/billing/pricing.js`.
- Checkout amounts are sent in the smallest currency unit and stored in `subscriptions.amount_minor_units`.
- `subscriptions.amount_major` is the exact decimal major-unit snapshot. The legacy `amount` and `amount_paise` columns remain for India compatibility.
- The workspace's explicitly saved `business_profile.country_code` determines billing currency. Existing workspaces with no saved country retain the India (INR) default.
- Client-supplied plan prices, currency, and country are never trusted by the order-creation function.

## Launch prices (monthly)

| Country | Currency | Basic | Pro |
|---|---|---:|---:|
| India | INR | 199 | 249 |
| United States | USD | 5.99 | 9.99 |
| United Kingdom | GBP | 4.99 | 8.99 |
| UAE | AED | 19 | 35 |
| Canada | CAD | 7.99 | 12.99 |
| Australia | AUD | 7.99 | 14.99 |
| Singapore | SGD | 6.99 | 12.99 |

India's existing yearly prices remain INR 999 (Basic) and INR 1,599 (Pro). Global yearly billing is not enabled yet.

## Cashfree currency availability

The application permits direct Cashfree order creation for INR, USD, GBP, CAD, AUD, and SGD. UAE pricing is displayed in AED, but AED checkout remains disabled until the merchant's Cashfree account and current API configuration explicitly confirm AED as an order currency. Cashfree marketing materials mention AED in some international checkout/DCC contexts, while its published supported-currency table does not list AED as a direct currency. Do not bypass this guard by silently charging another currency or inventing an FX rate.

Cashfree international payments settle to the merchant in INR according to the merchant's approved cross-border setup. Plivex stores the original customer payment currency and amount; it does not calculate or persist an estimated FX conversion.

## Payment lifecycle and integrity

- The browser requests an order; the Edge Function authenticates the user and derives country, plan, currency, and price from server-side data.
- The order is stored before Cashfree is called, with a unique order/idempotency key.
- Webhooks are HMAC-verified. The return page independently fetches the Cashfree order/payment state.
- Both paths use `apply_cashfree_subscription_payment`, a service-role-only SECURITY DEFINER function that locks the subscription row, validates currency and amount, transitions the order once, and writes one payment ledger row in the same database transaction.
- Failed and pending payment events update payment state without granting access.
- Refund events are stored in `payment_refunds` with a unique provider refund ID. Successful partial refunds are summed; a full refund revokes the paid subscription.
- Workspace admins can schedule or withdraw cancellation at the end of the current paid period. Paid access remains until the recorded expiry.
- Manual renewal and plan changes are supported through a new verified checkout. A Basic downgrade is queued behind the current active higher-tier period; same-tier renewal extends the paid period.

## Activation and operational limitations

- No Cashfree production secrets are stored in source. The existing `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`, and `CASHFREE_ENV` configuration must be set in Supabase Edge Function secrets by the authorized operator.
- International checkout only works after Cashfree activates the merchant's international acceptance capability and approves the relevant currencies/payment methods.
- Automatic recurring debit/mandates are not enabled in this Part 3 implementation. Renewals are customer-initiated; do not describe the current service as auto-renewing.
- No live Supabase migration, Edge Function deployment, Cashfree merchant setting, production deployment, or payment test is performed by a Git commit.
- Tax, VAT/GST calculation, tax jurisdiction, legal invoice compliance, and FX conversion are outside this Part 3 payment/subscription scope.
