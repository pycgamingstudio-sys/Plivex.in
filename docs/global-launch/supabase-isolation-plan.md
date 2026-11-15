# Plivex Global — Existing Supabase Isolation Plan

Status: design baseline only; no database or runtime changes have been applied.

Repository: `pycgamingstudio-sys/Plivex.in`
Branch: `global-dev`
Design baseline: `f26841b02e95f326bdd94a1104b4acc5558c8453`

## Decision constraints

- Keep the existing Supabase project as requested.
- Preserve the India edition and its current production data and behavior.
- Do not apply migrations, deploy Edge Functions, change DNS, bind a Worker route, or enable Cashfree Live as part of this plan.
- Cashfree provider lifecycle testing is deferred.
- Global hostname target: `global.plivex.in`; DNS/Worker activation requires a separate release authorization.

## Verified architecture facts

1. `supabase/config.toml` points to project `sqzpaiibmfsvarrkwkvb`, the existing Plivex Supabase project.
2. `src/api/backendClient.js` uses the same Supabase Auth session and reads/writes the shared `public.profiles` table. Its migrated Edge Function allowlist includes shared function names such as `ensure-owner-role`, `workspace-records`, `list-invoices`, and `save-invoice`.
3. `src/lib/AuthContext.jsx` provisions the owner through `ensureOwnerRole`, then hydrates the workspace.
4. `supabase/functions/ensure-owner-role/index.ts` reads/writes `public.profiles`, `public.invite_codes`, `public.workspace_members`, and `public.business_profile`.
5. `supabase/functions/workspace-records/index.ts` reads `public.profiles` and performs CRUD against shared `public` business tables.
6. `supabase/functions/save-invoice/index.ts` reads `public.profiles`, `public.business_profile`, and `public.invoices`, then calls shared `public.save_invoice`.
7. Global country and tax migrations currently alter `public.business_profile`; invoice and refund work also uses shared public objects. Applying these migrations to the existing project without a full compatibility review is not safe.
8. The app's current Wrangler config is named `plivex-in` and contains the existing production Supabase public endpoint/key. It is not a separate Global Worker configuration.

## Isolation design required before runtime cutover

Use a dedicated Postgres schema named `global` for Global-owned application data while retaining Supabase Auth as the shared identity provider. Shared Auth means the same Supabase identity may sign in to either edition; it does **not** mean the two editions may share profiles, workspaces, invoices, memberships, billing state, or business records.

Global must have its own schema-scoped tables and RPCs, including at minimum:

- `global.user_profiles` (keyed to `auth.users.id`, with Global-only role/workspace linkage)
- `global.workspaces` and `global.workspace_members`
- `global.business_profile`
- `global.invoices` and `global.invoice_items`
- Global-owned clients, expenses, stock, services, leads, quotations, payment/subscription/refund records and supporting audit/event tables as applicable
- Global-only RPCs such as `global.save_invoice`, with explicit grants and RLS policies

Do not copy or migrate India rows into Global tables automatically. Existing Global users must be provisioned explicitly through a controlled onboarding path. Global API handlers must resolve the Global profile and Global workspace only; they must not fall back to `public.profiles` or `public` business tables.

## Required implementation sequence

1. **Inventory and contract map:** enumerate every frontend operation, Edge Function, SQL RPC, table, trigger, policy, scheduled job, and webhook used by Global. Mark every current `public` dependency.
2. **Schema foundation:** add an additive, unapplied migration creating `global` schema, tables, indexes, constraints, RLS, grants, and Global RPCs. Confirm no existing `public` object is altered or replaced.
3. **Backend isolation:** create Global-specific Edge Function names (for example `global-ensure-owner-role`, `global-workspace-records`, `global-save-invoice`) and switch Global frontend calls to those names. Each handler must use the Global schema and enforce the caller's Global workspace.
4. **Auth and onboarding:** use Supabase Auth as identity only; create/read a separate Global profile. Test a user who already has an India profile, a new identity, an invited member, and a user with no Global profile. Never infer Global admin privileges from an India profile.
5. **Data and security tests:** prove RLS isolation across two Global workspaces, Global-vs-India isolation, anon denial, authenticated least privilege, RPC execution grants, and webhook/service-role boundaries.
6. **Subdomain preparation:** add a separate Global Worker configuration/build target and allow `https://global.plivex.in` only in Global-specific CORS/origin allowlists. Do not change the existing `plivex-in` Worker or production route.
7. **Preview verification:** deploy only to an isolated preview target after review; run signup/login, invoice create/edit/PDF, tax validation, CRUD, mobile/desktop smoke, and regression tests.
8. **Independent gates:** Chat 2 tests and fixes; Chat 3 independently audits the exact candidate SHA; Chat 4 approves before any production release action.

## Hard blockers / release gates

- The current Global branch is not isolated from India at the database/auth-profile layer.
- A separate schema alone is insufficient: all Global frontend calls, Edge Functions, RPCs, RLS, background jobs, webhook paths, and tests must be moved to the Global namespace.
- Shared Supabase Auth is an intentional coupling. If the product requirement is fully separate user identities/passwords, a separate Supabase project is required instead.
- Do not run the existing Global migration set against the live shared project; it alters shared `public` objects.
- Do not attach `global.plivex.in` to the existing production Worker until the isolated Global build and origin routing have passed all gates.

## Validation record

- Source inspection completed for `supabase/config.toml`, `src/api/backendClient.js`, `src/lib/AuthContext.jsx`, `src/lib/stores.js`, `supabase/functions/ensure-owner-role/index.ts`, `supabase/functions/workspace-records/index.ts`, `supabase/functions/save-invoice/index.ts`, and representative Global migrations.
- No code build, test suite, browser smoke test, migration, deployment, DNS update, or live payment was executed by this design-only step.
