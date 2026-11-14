# Stage 4 remediation evidence and remaining gates

Repository: `pycgamingstudio-sys/Plivex.in`  
Branch: `global-dev`  
Current candidate at time of this report: `7d67171aeeae039544610f20390319f91b95fb5e`  
Previous Stage 4 remediation candidate: `3cfd73601bd5b7acb455e732118ea42c834e95f2`

## Exact-SHA CI evidence

All runs below checked out the exact candidate SHA `7d67171aeeae039544610f20390319f91b95fb5e`.

| Workflow | Run ID | Result |
|---|---:|---|
| Global Foundation CI | 43547155661 | SUCCESS |
| PostgreSQL Subscription Integration | 43547155682 | SUCCESS |
| Stage 4 Remediation Verification | 43547155627 | FAILURE — M-3 replay guard conflict |

Relevant executed test evidence from the PostgreSQL integration run:

- Cashfree subscription handler suite: 12 passed, 0 failed.
- Cashfree shared tests: 8 passed, 0 failed.
- Refund + shared Cashfree tests: 13 passed, 0 failed.
- Actual handler/PostgREST integration: 1 passed, 0 failed.
- ESLint, TypeScript, Deno Cashfree checks, production build, and public build-environment verification completed successfully.

The dedicated Stage 4 workflow's separate Auth job passed: job ID `132301030026`, actual disposable GoTrue `auth.getUser()`, Cashfree handler cancel/resume, and persisted PostgREST/PostgreSQL state. It passed 1 test, 0 failed.

The dedicated migration replay job failed: job ID `132301029697`. The failure is detailed below. No replay, rollback, or India data-integrity pass is claimed.

## M-1 — Authentication tests

Addressed and verified on the exact candidate SHA:

- Missing Bearer token → 401.
- Invalid/expired token returned by `auth.getUser()` → 401.
- Null user without an Auth error → 401.
- Invalid authentication does not reach profile/subscription lookup or mutate state.
- Origin, method, role, workspace, and Cashfree-only provider restrictions remain covered.

The handler suite executed 12 tests, 0 failures. The new separate Auth integration job uses an isolated GoTrue service and does not stub `auth.getUser()`.

## M-2 — Handler-to-PostgREST/PostgreSQL and real Auth

Accepted with the prior limitation now addressed in a disposable integration lane.

- The actual exported Cashfree subscription handler is invoked.
- GoTrue creates and authenticates a disposable test user.
- The handler validates the actual GoTrue access token with `auth.getUser()`.
- Profile lookup and subscription reads/updates pass through PostgREST to disposable PostgreSQL.
- Cancel and resume are checked against persisted database state.
- An invalid token is rejected and must not mutate subscription state.

This is a real disposable GoTrue + PostgREST integration, not a hosted production Supabase or deployed Edge Function test. No production Auth or database endpoint was used.

## M-3 — Remote migration reconciliation and replay

Read-only production ledger query:

`SELECT version, name, statements FROM supabase_migrations.schema_migrations ORDER BY version;`

The query returned 47 remote ledger entries. No production schema, migration ledger, data, permission, RLS policy, or deployment was modified.

Reconciliation counts:

- 47 remote ledger entries.
- 23 current local migration files.
- 0 exact version-string matches.
- 12 same-basename remote/local pairs.
- 8/12 normalized SQL body matches.
- 4/12 divergent same-basename pairs.
- 39 recovered historical SQL sources: 35 missing-by-basename plus 4 divergent remote versions.
- 11 local-only migration files not represented in the remote ledger.

All 39 archived SQL files were independently fetched from the exact candidate; each GitHub blob SHA matched its manifest SHA.

### Actual disposable replay result

The new Stage 4 replay workflow successfully started two isolated Supabase PostgreSQL containers and applied the replay bootstrap. The remote-history replay then failed at:

`20261028030245_prioritize_effective_subscription.sql`

Actual PostgreSQL error:

`Unexpected current_plan ordering; refusing to modify`

The archived earlier function definition in `20261025030902_preserve_running_trials_and_access_status.sql` uses the order fragment `order by s.expires_at desc,s.created_at desc`. The later remote migration's guard expects either a differently spaced old fragment or its canonical Pro-first CASE expression. The recorded preceding SQL does not produce either exact string in a clean replay. Its subsequent `get_access_status` guard also expects query fragments not established by the preceding archived function source.

A read-only production `pg_get_functiondef` query confirms that the current live `current_plan` and `get_access_status` definitions already contain Pro-first effective-subscription ordering. That is evidence of the current post-migration state; it does not establish the exact historical precondition at the time migration `20261028030245` ran.

A second ordering concern exists in the local-only `202610280004_fix_overlapping_subscription_tier_priority.sql`: it uses a different lowercase CASE and `get_access_status` transformation. The later local `202611130004_converge_effective_subscription_priority.sql` explicitly converges known variants. The candidate replay lane was not reached, so no claim is made that the combined remote/local sequence replays cleanly.

The replay harness also recovered the pre-existing `public.workspace_cycle_start(text,timestamptz)` definition through a read-only production function-definition query. That fixture was necessary because remote migration `20261025092518` revokes privileges from the function but its CREATE statement is absent from the 47-row ledger. This fixture is used only in disposable replay databases.

**M-3 remains a release blocker.** Do not bypass the guard, silently rewrite archived remote SQL, reorder migrations, or infer historical function bodies from current production state. Chat 4 must decide the safe reconciliation for the `20261028030245` / local-only `202610280004` function-definition divergence before a full replay can be claimed.

The replay did not reach the later India entitlement migration or final rollback/data-integrity assertions. Those results remain unverified.

### India Basic entitlement divergence

The archived remote `20261113040332_basic_plan_lead_management` SQL enables Basic lead-pipeline access in the shared `plan_features` / `plan_limits` catalogue. The local same-basename migration is intentionally a no-op to avoid changing India entitlements. Do not replay the archived remote SQL blindly. Chat 4 must decide whether a safe edition-aware entitlement design is required.

## M-4 — Cashfree Sandbox

Status: **externally blocked; no Sandbox lifecycle execution claimed.**

Required prerequisites:
- Cashfree Sandbox merchant activation.
- Sandbox App ID and Secret Key.
- Sandbox webhook endpoint configuration.
- Sandbox webhook signing secret.
- Provider-side test order/payment/refund/replay evidence.

A complete lifecycle plan is in `docs/STAGE4-CASHFREE-SANDBOX-TEST-PLAN.md`. Execute it only after legitimate Sandbox access is configured through approved secret management. Never paste credentials into chat or commit them. No Cashfree Live transaction or refund was used.

## Payment scope and India regression

Cashfree is the Global website payment provider. PayU lifecycle work is excluded from Stage 4.

India protection is limited to regression checks for stored INR/PayU subscription and payment records and verification that Cashfree-only operations do not mutate unrelated legacy rows. The disposable handler/PostgreSQL integration checks that a same-workspace legacy PayU row remains unchanged after Cashfree cancel/resume/status operations. No India production behavior was changed.

## Branch protection recommendation (not applied)

Recommendation is documented in `docs/GLOBAL-DEV-BRANCH-PROTECTION-RECOMMENDATION.md`.

Repository metadata at this report:
- `global-dev` protection: disabled.
- `main` remains at `b3fb11647ca436d28c6b4dccac733c94ad605f21`.
- No repository settings or branch protection rules were changed.

## Safety boundary

All commits and test fixtures remain on `global-dev`. No merge, production deployment, production migration, live permission/RLS change, Cloudflare production change, Cashfree Live payment/refund, or India production change was performed. The only production database access in this remediation was read-only SQL to inspect the migration ledger and function definitions.
