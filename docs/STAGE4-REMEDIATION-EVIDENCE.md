# Stage 4 remediation evidence and remaining gates

Repository: `pycgamingstudio-sys/Plivex.in`  
Branch: `global-dev`  
Previous Stage 4 candidate: `2e0e43e22b6b051c65ee5272cfe0a0d6f270110a`

## M-3 — read-only migration ledger reconciliation

The production migration ledger was queried read-only using only:

`SELECT version, name, statements FROM supabase_migrations.schema_migrations ORDER BY version;`

The query returned 47 rows. No production schema, migration ledger, data, permission, RLS policy, or deployment was modified.

Reconciliation captured in `supabase/recovered_remote_migrations/README.md` and `manifest.json`:

- 47 remote ledger entries.
- 23 local migration files on `global-dev`.
- 0 exact version-string matches.
- 12 remote entries share a basename with a local migration.
- 8/12 same-basename pairs have normalized SQL bodies matching.
- 4/12 same-basename pairs differ; exact remote statement bodies are archived separately.
- 39 historical SQL sources were recovered from the ledger: 35 missing by basename plus 4 divergent remote versions.
- 11 local-only migration files remain local and are not represented in the remote ledger.

The archive is intentionally outside `supabase/migrations`, so Supabase CLI will not auto-apply it.

### Replay and data-integrity limitation

A complete ordered replay of all 47 historical statements against a disposable Supabase-compatible platform, including full rollback and data-integrity verification, has **not** yet been established. Several historical statements depend on Supabase-managed Auth, Storage, Vault, pg_cron, and pg_net objects. A vanilla PostgreSQL fixture is not equivalent to a disposable Supabase platform.

There is also a material India-edition decision: the remote `20261113040332_basic_plan_lead_management` statement enables Basic lead-pipeline access in the shared `plan_features` catalogue, while the local same-basename migration is intentionally a no-op to avoid changing India entitlements. Do not replay that remote SQL blindly. Chat 4 must decide whether the global entitlement should be represented with an edition discriminator or remain disabled in the shared catalogue.

Existing selected CI migration fixtures still test rollback, reapplication, and billing data integrity for migrations 007–010; these are not a full historical replay.

## M-4 — Cashfree Sandbox

No Cashfree Sandbox order/payment/webhook/refund lifecycle was executed in this remediation. No verified Sandbox merchant activation or Sandbox API credentials were supplied in the authorized development context, and no connected Cashfree Sandbox credential/transaction tool is available here.

Exact blocked items:
- Sandbox client ID and secret / merchant sandbox activation.
- Sandbox webhook endpoint configuration and signing secret.
- Provider-side order, payment, refund and replay evidence.

No Live credentials were requested or used. No Live transaction or refund was performed. Resume only after the merchant supplies/activates Sandbox configuration through the approved secret-management channel; never paste credentials into chat or commit them.

## PayU India compatibility

Existing disposable PostgreSQL billing fixture verifies legacy INR PayU yearly subscription metadata and access dates survive the additive Cashfree billing migrations. The handler unit suite also protects PayU subscriptions from Cashfree cancellation. The new handler/PostgreSQL fixture adds a PayU row in the same workspace and checks it remains unchanged after the Cashfree handler flow, once that integration test passes.

This is compatibility evidence for stored legacy records and Cashfree isolation. It does not prove the real PayU provider order, callback, renewal, cancellation, or refund lifecycle. No PayU production behavior was changed.

## Branch protection recommendation (not applied)

Recommended settings for `global-dev` before release:
1. Require pull requests before merge and at least one independent approval.
2. Dismiss stale approvals after new commits; require conversation resolution.
3. Require both CI workflows to pass, selecting the exact check contexts from the final candidate's GitHub check suite rather than guessing context names.
4. Require branches to be up to date before merge.
5. Block force pushes and branch deletion.
6. Restrict direct pushes to maintainers; keep `main` protected separately.

Repository settings were not changed. No branch-protection API write was made.

## Safety boundary

No main/production code, production Supabase schema/data/ledger/RLS/grants, production Edge Functions, Cloudflare production, Cashfree Live, or India production behavior was modified. This document is evidence and recommendations only.
