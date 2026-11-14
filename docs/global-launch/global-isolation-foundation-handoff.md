# Global Isolation Foundation — Implementation Handoff

Repository: `pycgamingstudio-sys/Plivex.in`
Branch: `global-dev`
Current implementation SHA at handoff: `d5c5174871b7f624eaa5fa8c02cf1578553b8478`

## Implemented

- Added additive migration `supabase/migrations/202611150001_global_isolation_foundation.sql`.
- Created private `global` schema; the migration does not alter or drop any `public` object.
- Added Global-only `workspaces`, `user_profiles`, `workspace_members`, and `business_profiles` tables.
- Added Global membership/admin RLS helper functions with fixed search paths.
- Enabled RLS on all four Global tables.
- Added member-only workspace/profile/business-profile read policies and owner/admin business-profile update policy.
- Left profile/workspace/membership provisioning without authenticated INSERT/DELETE policies; provisioning is intended to happen through separately reviewed server-side Global handlers.
- Granted schema/table access to service_role for future Edge Function operations; authenticated access is restricted by grants and RLS.
- Added updated_at triggers for the four tables.
- Added `src/global/tests/isolation-migration.test.mjs` with static assertions for additive migration scope, Global membership authorization, RLS, and identifier constraints.

## Explicitly not implemented in this part

- No live migration has been applied.
- No Global Edge Function has been created or deployed.
- No Global frontend auth/data routing has been switched.
- No Global invoices, clients, inventory, expenses, subscriptions, or payment tables have been created yet.
- No Auth users or business records have been copied from India.
- No Cloudflare Worker, DNS, or production route has been changed.
- Cashfree remains deferred.

## Test evidence

GitHub Actions runs triggered for the evolving commits during implementation. Earlier PostgreSQL integration attempts exposed two failures in the newly added static test assertions (not in the migration execution); those assertions were corrected in commit `d5c5174871b7f624eaa5fa8c02cf1578553b8478`. The final SHA's CI is pending at the time of this report; no final pass is claimed. Chat 2 must run/review the final candidate and report exact-SHA results.

## Risks and limitations for review

1. The schema is not yet wired to Global runtime calls. This migration alone does not deliver an operational Global edition.
2. Global provisioning and Edge Function authorization still need implementation and security tests.
3. Authenticated schema usage is granted for policy evaluation, but the `global` schema must remain outside exposed PostgREST schemas unless a later review explicitly approves direct client access.
4. Service-role Edge Functions bypass RLS; every future handler must validate the caller's Global membership/role before every operation.
5. The current Global branch contains prior migrations that alter shared `public` tables. They must be replaced or isolated before any production migration replay.
6. Migration replay/rollback against a disposable PostgreSQL/Supabase-compatible environment remains required.

## Requested handoff

Chat 2: test this exact SHA after CI completes; add migration replay/rollback and RLS checks, and do not apply it to live Supabase.

Chat 3: independently review schema grants, RLS helper safety, tenant isolation, and India regression scope after Chat 2's final report.

Chat 4: approve or reject this part only after both reports and exact-SHA evidence. No merge to `main`, production migration, Cloudflare DNS/Worker routing, or Global launch is authorized by this handoff.
