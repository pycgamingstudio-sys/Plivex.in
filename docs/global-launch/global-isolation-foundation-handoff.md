# Global Isolation Foundation — Final Testing and Audit Record

Repository: `pycgamingstudio-sys/Plivex.in`  
Branch: `global-dev`  
Exact candidate SHA: `7db2eb92e4a14a9595d1b51b2a6866148c33386b`

## Implemented

- Added additive migration `supabase/migrations/202611150001_global_isolation_foundation.sql`.
- Created the private `global` schema; the migration does not alter or drop any `public` object.
- Added Global-only `workspaces`, `user_profiles`, `workspace_members`, and `business_profiles` tables.
- Added Global membership/admin RLS helper functions with fixed search paths.
- Enabled RLS on all four Global tables.
- Added member-only workspace/membership/business-profile reads, self-only profile reads, and owner/admin business-profile updates.
- Left workspace/profile/membership provisioning without authenticated INSERT/DELETE permissions; future provisioning must use separately reviewed server-side Global handlers.
- Granted schema/table access to service_role for future Edge Function operations; authenticated access is restricted by grants and RLS.
- Added updated_at triggers for the four tables.
- Added static migration assertions in `src/global/tests/isolation-migration.test.mjs`.
- Added runtime SQL coverage in `supabase/tests/global-isolation-foundation.integration.sql` for two separate Global workspaces, anonymous denial, India-only profile separation, and least-privilege provisioning.
- Added the new migration to the disposable candidate replay manifest and expanded replay from 62 to 63 entries.

## Exact-SHA test evidence

All listed runs completed successfully on exact SHA `7db2eb92e4a14a9595d1b51b2a6866148c33386b`:

| Workflow | Run ID | Result |
|---|---:|---|
| Global Foundation CI | 43610242287 | SUCCESS |
| PostgreSQL Subscription Integration | 43610242313 | SUCCESS |
| Stage 4 Remediation Verification | 43610242309 | SUCCESS |

- [Global Foundation CI](https://github.com/pycgamingstudio-sys/Plivex.in/actions/runs/43610242287)
- [PostgreSQL Subscription Integration](https://github.com/pycgamingstudio-sys/Plivex.in/actions/runs/43610242313)
- [Stage 4 Remediation Verification](https://github.com/pycgamingstudio-sys/Plivex.in/actions/runs/43610242309)

The new disposable replay job applied `202611150001_global_isolation_foundation.sql` as part of the 35 recovered + 28 current-local candidate migrations. Its logs recorded:
- Global foundation table/RLS/grant catalog assertions passed.
- Two-workspace Global RLS integration SQL completed successfully.
- Actual Global foundation DDL rollback test passed in a separate disposable database.
- India entitlement/data-integrity assertions passed.
- Final candidate replay summary: `30|39|0|0`.

The PostgreSQL Subscription Integration workflow also completed its India membership, Global/India regression, migration/RLS, tax compatibility, billing/refund, handler integration, lint, TypeScript, Deno, production build, and public build-configuration steps successfully.

## Independent security and regression review

**Part decision: APPROVED WITH LIMITATIONS for branch-only foundation work.**

Reviewed:
- Global membership checks derive only from `global.workspace_members`; India `public.profiles` alone does not grant Global membership/admin rights.
- Anonymous role cannot access the Global schema.
- Two synthetic Global users see only their own workspace, membership, profile, and business profile in the disposable RLS integration test.
- Authenticated users do not have direct workspace/membership/profile provisioning privileges.
- The migration is additive and does not alter or drop India `public` objects.
- Candidate replay preserves the India regression sentinel and entitlement assertions.
- Migration rollback was tested against the actual migration DDL in an isolated disposable database.

## Limitations — not a Global launch approval

- No live Supabase migration has been applied.
- No Global Edge Function has been created or deployed.
- No Global frontend auth/data routing has been switched.
- No Global invoices, clients, inventory, expenses, subscriptions, or payment tables have been created yet.
- No Auth users or business records have been copied from India.
- No Cloudflare Worker, DNS, or production route has been changed.
- Cashfree remains deferred.
- Prior Global branch migrations that alter shared `public` tables still require a separately reviewed isolation/replacement plan before any production migration replay.
- Service-role Edge Functions bypass RLS; every future handler must validate the caller's Global membership/role before every operation.
- The `global` schema must remain outside exposed PostgREST schemas unless a later review explicitly approves direct client access.

## Approval boundary

This approval covers only the Global isolation foundation on `global-dev`. It does not authorize a live Supabase migration, merge to `main`, Cloudflare production routing, or public launch. The next implementation part may begin on `global-dev`; production actions remain blocked until their own review and deployment checks are complete.
