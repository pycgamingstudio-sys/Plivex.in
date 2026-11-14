# Stage 4 external verification and release-gate plan

## Payment provider scope

Cashfree is the Global website payment provider. This Stage 4 work does not implement, test, or change a PayU payment lifecycle. India compatibility is checked only as a regression boundary: existing INR/PayU records and metadata must remain intact and Global Cashfree cancellation must not mutate unrelated provider rows.

## Cashfree Sandbox lifecycle plan

Status on 2026-11-14: **BLOCKED — merchant-side Sandbox activation and credentials have not been supplied/verified.** No Cashfree Live transaction is an acceptable substitute.

Required prerequisites, supplied only through the approved Cashfree/GitHub secret-management channels:
- Cashfree Sandbox merchant account activated for the Plivex merchant.
- Sandbox App ID and Secret Key.
- Sandbox webhook signing secret and configured webhook URL.
- Confirmation that the Sandbox merchant account has the intended currencies/products enabled.
- Test customer and test payment method supported by Cashfree Sandbox.

Never commit credentials, paste them into chat, print them in CI logs, or store them in fixtures. CI should consume GitHub Actions secrets only after the project owner explicitly configures them.

### Execution sequence once Sandbox access is available

1. **Create order:** call the Global order-creation path using Sandbox credentials; assert server-side order creation, expected currency/amount, workspace ownership, and idempotency key.
2. **Pending payment:** confirm a newly created order remains pending and does not grant a paid subscription.
3. **Successful payment:** complete a Sandbox payment; verify provider order/payment identifiers, amount/currency, signature or provider verification, and exactly one subscription activation.
4. **Webhook validation:** send a correctly signed event; assert accepted response and persisted event identity. Send a tampered signature; assert rejection and no state mutation.
5. **Replay/idempotency:** resend the same valid event and then an out-of-order/duplicate event; assert no duplicate subscription, invoice, payment log, or entitlement extension.
6. **Failure/cancellation:** exercise a failed or cancelled Sandbox payment; assert no paid entitlement is granted and the record remains auditable.
7. **Refund:** issue a Sandbox refund using the provider-supported flow; verify refund identity, amount, status, linkage to the original payment, and no cross-workspace mutation.
8. **Refund webhook replay:** replay the same refund event; assert idempotent handling and no double reversal.
9. **Reconciliation:** compare Cashfree Sandbox dashboard order/payment/refund IDs with disposable test database records and retain redacted evidence.

### Current evidence and blocker

No Sandbox lifecycle step above has been claimed as executed. The exact blocker is external merchant activation plus the missing Sandbox App ID, Secret Key, webhook signing secret, and endpoint configuration. The CI suite must remain credential-free until these prerequisites are legitimately provisioned. Cashfree Live remains explicitly out of scope.

## India edition regression boundary

- Keep the India INR/PayU production integration untouched.
- Use only disposable test data for regression sentinels.
- Assert legacy PayU subscription and payment-log identifiers, provider/gateway metadata, INR amount, status, and entitlements remain unchanged by Global Cashfree handler tests.
- Do not replay the archived remote Basic lead-management SQL into the Global candidate because the local migration is intentionally a no-op to protect the shared India entitlement catalogue.
- No production migration, permission change, payment, refund, or deployment is authorized by these tests.

## Migration replay caveats

The replay harness uses isolated Supabase PostgreSQL-compatible containers and local stubs for Supabase-managed Auth/Storage/Vault helpers. A passing replay demonstrates SQL execution against that disposable compatibility layer; it does not prove production schema parity with every managed Supabase service. The remote history replay deliberately reproduces the archived Basic lead entitlement change as a comparison case. The Global candidate replay uses the current local migrations and asserts the India Basic entitlement sentinel remains unchanged.

The archived historical source containing `DROP TABLE IF EXISTS public.profiles CASCADE` is intentionally replayed only in a fresh disposable database. It must never be applied to a populated or production database.

## Stage 4 status

Stage 4 remains on HOLD until Chat 2 tests and Chat 3 independently audits the same exact candidate SHA, then Chat 4 issues a new decision. Passing CI is not production authorization.
