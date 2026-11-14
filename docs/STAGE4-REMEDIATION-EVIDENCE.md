# Stage 4 remediation evidence and remaining gates

Repository: `pycgamingstudio-sys/Plivex.in`  
Branch: `global-dev`

## Current Stage 4 remediation result

<badge>Verification passed on the tested candidate</badge>

The subscription-priority migration conflict has been remediated on `global-dev` without editing archived remote SQL or weakening fail-closed guards.

### Migration changes

- `202610280004_fix_overlapping_subscription_tier_priority.sql` now recognizes the recorded whitespace variants in `current_plan`, emits the exact Pro-first ordering expected by remote migration `20261028030245`, and converges `get_access_status` expiry and startedAt queries to the same effective subscription.
- The migration validates all expected fragments before executing either function definition. Unknown definitions still fail closed.
- The Free-plan `startedAt` value is preserved. The later convergence migration accepts both documented Free-plan variants: profile creation time and NULL; it only converges the paid-plan subscription selection.
- The PostgreSQL integration fixture now executes the local `202610280004` plus archived remote `20261028030245` sequence.

### Exact-SHA CI evidence

The tested candidate SHA and workflow run IDs are recorded in the Stage 4 handoff accompanying this evidence file. All three required workflows completed successfully on the same tested candidate:

- Global Foundation CI — SUCCESS.
- PostgreSQL Subscription Integration — SUCCESS.
- Stage 4 Remediation Verification — SUCCESS.

The Stage 4 workflow's disposable GoTrue/Auth + Cashfree handler/PostgREST job passed. Its separate migration replay job also passed.

### Migration replay evidence

Read-only production reconciliation still identifies:

- 47 remote migration-ledger entries.
- 23 current local migration files.
- 0 exact version-string matches.
- 12 same-basename pairs: 8 normalized SQL matches and 4 divergent pairs.
- 39 recovered remote SQL sources: 35 missing-by-basename plus 4 divergent remote versions.
- 11 local-only migration files.

All 39 recovered SQL files were verified against their manifest Git blob SHA.

Replay results:

- All 47 archived remote versions applied successfully in the disposable remote-history database **with one explicitly documented local-only compatibility bridge**: `202610280004` is applied after the normalized `20261027143138` source to reconstruct the Pro-first function precondition observed in the read-only live Supabase function definitions. This is not represented as a pure 47-file replay without a bridge.
- The full global candidate sequence — 35 recovered historical sources plus all 23 current local migrations — applied successfully in a separate disposable database.
- RLS assertions passed for the required public tables.
- The remote replay preserved its India PayU regression row.
- The global candidate replay preserved India PayU payment/subscription values and the local Basic lead entitlement no-op (`false|0|total`).
- Transaction rollback verification passed.
- The remote archive and version-order checks passed.

The remote archive's Basic lead-pipeline migration still differs from the local no-op. The replay deliberately preserves and reports that edition divergence; it does not blindly apply the remote entitlement change to the global candidate.

## M-1 — Authentication

Verified:

- Missing, invalid/expired, and null-user Bearer authentication paths reject with 401.
- Invalid authentication does not reach profile/subscription lookup or mutate state.
- The actual disposable GoTrue integration invokes `auth.getUser()`; it is not mocked.
- Handler suite: 12 passed, 0 failed.

## M-2 — Handler / PostgREST / PostgreSQL integration

Verified in disposable services:

- Actual exported Cashfree subscription handler invocation.
- Real disposable GoTrue user creation, password sign-in, access token, and `auth.getUser()`.
- Profile and subscription reads/writes through PostgREST to PostgreSQL.
- Cancel/resume persistence.
- Invalid token rejection without state mutation.

This does not claim a hosted production Supabase or deployed Edge Function test.

## India compatibility and payment scope

Cashfree is the Global website payment provider. PayU lifecycle work is excluded.

India compatibility was checked only as regression protection in disposable databases. No India production behavior, PayU lifecycle, or production data was changed.

## M-4 — Cashfree Sandbox remains externally blocked

No Sandbox lifecycle is claimed. Required prerequisites remain:

- Cashfree Sandbox merchant activation.
- Sandbox App ID and Secret Key configured through approved secret management.
- Sandbox webhook endpoint and signing secret.
- Provider-side order/payment/refund/replay evidence.

No Cashfree Live transaction or refund was used.

## Independent security findings still open

The prior independent audit identified Cashfree webhook concerns not covered by the migration remediation:

- A delayed non-success event may overwrite an earlier non-success payment status while the subscription remains unactivated.
- Webhook signature timestamp freshness is not enforced.

These findings require a separately authorized, narrowly scoped Cashfree webhook remediation and tests. They are not marked fixed.

## Branch protection and candidate status

- `global-dev` branch protection remains disabled; required checks are not enforced.
- Branch-protection recommendation is documented but settings were not changed.
- The candidate commit is unsigned.
- Chat 2 and Chat 3 must independently retest/re-audit the exact final SHA after the documentation cleanup commit.
- Chat 4 remains the final Stage 4 approver. CI success is not Chat 4 approval or deployment authorization.

## Safety boundary

All changes remain on `global-dev`. No merge, production deployment, production migration, production permission/RLS change, Cloudflare production change, Cashfree Live payment/refund, or India production change was performed. Production Supabase access was read-only for migration-ledger and function-definition inspection only.
