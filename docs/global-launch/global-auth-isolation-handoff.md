# Plivex Global — Auth and Workspace Isolation Handoff

Repository: `pycgamingstudio-sys/Plivex.in`  
Branch: `global-dev`  
Exact tested SHA: `7510cd03626fd67e139bc8bff752bfa54e582457`

## Part scope

Edition-aware authentication and isolated Global owner workspace provisioning. This part does not implement Global invoices, clients, stock, expenses, or subscriptions.

## Implemented

- `VITE_APP_EDITION` resolves through the edition contract; the default remains India for existing builds.
- Global `auth.me()` calls the dedicated `global-auth-context` Edge Function instead of reading India `public.profiles`.
- Global owner bootstrap calls `global-ensure-owner`; profile edits call `global-update-profile`.
- Added a shared Global Edge Function helper with a strict origin allowlist for `global.plivex.in`, local development, and Cloudflare preview hostnames.
- Added service-role-only public RPC wrappers:
  - `public.global_get_auth_context(uuid)`
  - `public.global_provision_owner_workspace(uuid,text,text,text,text,text)`
  - `public.global_update_user_profile(uuid,text,text,text)`
- All Global records remain in the `global` schema. The public wrappers are revoked from `PUBLIC`, `anon`, and `authenticated`; only `service_role` can execute them.
- Owner provisioning uses a per-user advisory transaction lock, validates supported country/locale/currency combinations, is idempotent, and refuses to turn pending/suspended memberships into owner workspaces.
- Global local-storage tenant keys use a `global:` prefix and skip legacy India cache migration.
- Global authentication does not run India invite verification or India workspace hydration.
- Global backend function calls fail closed unless they target the Global owner-bootstrap endpoint; India Edge Functions are not used as fallback.
- Global paywall status is a restrictive Free placeholder; Global checkout is disabled while Cashfree remains deferred. Provider currency metadata was preserved to avoid changing the existing Cashfree contract.
- India-only invite and phone UI paths are hidden/blocked in Global; India behavior remains the default when `VITE_APP_EDITION` is not set to `global`.

## Exact-SHA CI evidence

All three workflows completed successfully on exact SHA `7510cd03626fd67e139bc8bff752bfa54e582457`:

| Workflow | Run ID | Result |
|---|---:|---|
| Global Foundation CI | 43611198029 | SUCCESS |
| PostgreSQL Subscription Integration | 43611198162 | SUCCESS |
| Stage 4 Remediation Verification | 43611198036 | SUCCESS |

- [Global Foundation CI](https://github.com/pycgamingstudio-sys/Plivex.in/actions/runs/43611198029)
- [PostgreSQL Subscription Integration](https://github.com/pycgamingstudio-sys/Plivex.in/actions/runs/43611198162)
- [Stage 4 Remediation Verification](https://github.com/pycgamingstudio-sys/Plivex.in/actions/runs/43611198036)

Disposable replay applied both:
- `202611150001_global_isolation_foundation.sql`
- `202611150002_global_owner_provisioning.sql`

Replay output confirmed:
- Global table/RLS/grant catalog assertions passed.
- Two-workspace Global RLS integration passed.
- Owner workspace creation and repeated bootstrap were idempotent.
- Pending invitation did not create a second owner workspace.
- Unsupported country/locale/currency combinations were rejected.
- Profile updates did not change membership role or workspace country.
- Browser roles could not execute service-role-only Global RPCs.
- Actual DDL rollback passed for both Global migrations.
- India entitlement/data-integrity checks passed.
- Candidate replay summary: `30|39|0|0`.

PostgreSQL Subscription Integration also passed the existing India membership, Cashfree, refund, RLS, Edge handler, TypeScript/Deno and production-build checks.

## Security and regression review

**Part decision: APPROVED WITH LIMITATIONS for branch-only Global auth work.**

- No Global auth path reads India `public.profiles`.
- No Global auth path calls India invite verification or India workspace provisioning.
- No Global login path migrates unscoped legacy India browser data.
- The owner-provisioning RPC is serialized and service-role-only.
- A pending or suspended Global membership cannot fall through into owner provisioning.
- Global non-Global Edge Function calls fail closed rather than falling back to India.
- Existing India/Cashfree integration tests and build checks passed on the same exact SHA.

## Limitations — not a Global launch approval

- Global workspace invitation acceptance is not implemented; invite links are rejected safely for now.
- Global workspace record hydration is intentionally disabled. Global invoices, clients, inventory, expenses and reporting are not operational yet.
- Global subscription tables, entitlement enforcement and payment processing are not implemented; Cashfree remains deferred.
- The three new Global Edge Functions are committed but have not been deployed.
- Neither Global migration has been applied to hosted Supabase.
- `VITE_APP_EDITION=global` has not been configured in a separate Cloudflare build target.
- No Global Worker, DNS, or production route has been created or changed.
- India production and `main` remain untouched.

## Approval boundary

This approval covers only Global auth/session isolation and owner provisioning on `global-dev`. It does not authorize live Supabase changes, Edge Function deployment, Cloudflare routing, merge to `main`, or public launch. The next branch-only implementation part may build Global business-data tables and handlers; all production actions remain blocked pending their own review.
