# H1 Backend Migration — Part 1 Inventory

**Branch:** `h1/migration-inventory`  
**Status:** Inventory/audit plus initial H1.2/H1.3 implementation sources. No production routing, DNS, database schema, policies, data, or live deployment changed.

## Current frontend routing

- `src/api/backendClient.js` reads `VITE_API_BASE_URL`, defaulting to `https://member-sync-flow.lovable.app`.
- Most business function calls still use `POST <API_BASE>/api/public/<kebab-name>` with the current Supabase access token.
- `add-client` is already routed to the Supabase Edge Function `add-client`.
- `src/components/AssistantWidget.jsx` invokes Supabase Edge Functions `assistant-chat` and `assistant-confirm` directly.
- Login, registration, confirmation, password reset, and session management use Supabase Auth directly.
- `StaffActivity`, `WorkspaceMember`, and `Subscription` entity adapters are currently inert (no-op/empty responses); these are functional gaps, not completed migrations.
- Image upload currently returns an inline resized PNG data URL, not a Supabase Storage upload.

## Supabase Edge Functions currently listed

Snapshot checked during H1.1:
- `assistant-chat` — ACTIVE, version 15, JWT verification enabled.
- `dynamic-api` — ACTIVE, version 1, JWT verification enabled; implementation appears to be a placeholder/demo and has not been mapped to a production API.
- `smart-function` — ACTIVE, version 1, JWT verification enabled; implementation appears to be a placeholder/demo and has not been mapped to a production API.
- `assistant-confirm` — ACTIVE, version 4, JWT verification enabled.
- `add-client` — ACTIVE, version 1, JWT verification enabled.

Active status alone does not prove endpoint behavior is correct. Assistant-chat logs previously showed POST failures with HTTP 502 due to a Gemini model 404; AI runtime verification remains outstanding.

## Required endpoint families

### Auth, workspace, and team
- `ensure-owner-role`
- `send-team-invite`
- `verify-invite-code`
- `get-workspace-team`
- `manage-workspace-member`
- `get-access-status`
- Presence/activity: `ping-presence`, `track-staff-action`, `get-team-presence`

### Business data
- Invoice save/status/delete/list operations and invoice-number allocation
- `get-business-summary`
- `workspace-records`
- `business-logo`
- Client, quotation, expense, stock, service, lead CRUD/read operations discovered by full frontend call-site mapping

### Payments and messaging
- `create-payu-order`
- `verify-payu-payment`
- `send-payment-reminder`
- Email integration has a reported dependency on Lovable's connector gateway; replace only after choosing and testing a supported mail provider.

### AI
- `assistant-chat`
- `assistant-confirm`

## H1.2 progress — team and workspace

- [x] Inspect RLS policies for `profiles`, `workspace_members`, `invite_codes`, and `staff_activity`.
- [x] Confirm profile reads are restricted to the signed-in user's own profile.
- [x] Confirm workspace member reads are scoped to the authenticated user's workspace and membership/ownership.
- [x] Add read-only `get-workspace-team` source: `supabase/functions/get-workspace-team/index.ts`.
- [x] Add authenticated `ping-presence` heartbeat source: `supabase/functions/ping-presence/index.ts`.
- [x] Add workspace-scoped `get-team-presence` reader source: `supabase/functions/get-team-presence/index.ts`.
- [ ] Deploy the three new functions to Supabase.
- [ ] Verify no-session requests return 401 and authenticated requests return only permitted workspace records.
- [ ] Route frontend team/presence calls only after deployed runtime checks pass.
- [ ] Continue with invite verification and member management after confirming the original handler contracts.

The available deployment tool blocked the function deployment request. The three new function sources are on this branch only and are **not deployed**. Existing production code still uses the current routes; no frontend has been switched to these not-yet-deployed functions.

## H1.3 readiness — business data mapping

The store layer maps UI fields to server rows for clients, expenses, stock, services, leads, quotations, business profile, and invoices. The client creation endpoint is already routed to Supabase. Each remaining read/write operation still needs an endpoint-by-endpoint mapping and runtime verification; this inventory does not claim business data migration complete.

## Known compatibility and safety requirements

- Preserve existing request/response shapes, HTTP status behavior, and frontend expectations; verify against original handlers before porting.
- Derive user/workspace identity from a verified Supabase session and database; never trust client-provided workspace or role IDs.
- Keep service-role credentials server-side only.
- Keep PayU tests in sandbox/test mode; no real-money tests.
- Do not modify schema, RLS, DB functions, or user data without a reviewed SQL plan and explicit approval.
- Keep the Lovable fallback in place until each replacement is implemented and tested.
- Do not merge this branch, change production routing, alter DNS, or pause/delete Lovable projects without explicit approval.

## Additional frontend call-site findings

- Team UI invokes `sendTeamInvite`, `manageWorkspaceMember`, `getWorkspaceTeam`, `ensureOwnerRole`, and `verifyInviteCode` through the compatibility adapter. The UI expects a versioned membership response with members, role/status counts, and workspace ID.
- Presence UI pings every 60 seconds, while `trackStaffAction` is no-op. Team presence reads `db.entities.StaffActivity`, whose adapter is inert. Presence is not functional until frontend adapters are connected and runtime tests pass.
- `stores.js` maps UI/database fields for clients, expenses, stock, services, leads, quotations, business profile, and invoices. The shared store is not proof every endpoint works.
- Current `backendClient.js` converts function names to kebab-case and posts to the Lovable API for all calls except `add-client`. This remains the primary fallback removal point after replacements pass tests.
- The active repository snapshot includes `.env` with Lovable base URLs, while `.env.example` is the template. Do not commit credentials or change production environment as part of inventory.

## Original source archive received (2026-10-27)

The owner supplied `lovable-project-b2d2bf01.zip`. Its original server-side contracts are now available in the working session, including:

- `src/lib/team.functions.ts`: `send-team-invite`, `verify-invite-code`, `get-workspace-team`, and `manage-workspace-member`.
- `src/lib/presence.functions.ts`: `ping-presence`, `track-staff-action`, and `get-team-presence`.
- `src/lib/ensure-owner-role.functions.ts`: self-signup owner bootstrap; invited non-admin staff must never be promoted to admin.
- `src/lib/payments.functions.ts`, `src/lib/payu.server.ts`, and `src/routes/api/public/payu/verify.ts`: PayU order creation, hash validation, callback handling, and access status.
- `src/lib/gmail.server.ts`: email delivery uses a Lovable connector gateway and Lovable/Google Mail secrets.
- `drizzle/migrations/*.sql`: original schema and RLS history.

**Important compatibility finding:** the archive is a TanStack Start backend, while the current Plivex frontend is React/Vite with Supabase Edge Functions. The live Supabase schema has drifted from the archive. For example, current `staff_activity` uses `created_by` rather than the archive's `user_id`, and the current subscription/payment columns differ from the original PayU handler. Original code must be adapted to the live schema, not copied blindly.

The archive contains a `.env` file. Its contents were intentionally not displayed, copied into repository files, or committed. Do not reuse or expose any secret values from that archive in frontend code.

## Verification notes

- Migration inventory and three new Edge Function source files are committed to `h1/migration-inventory`.
- Source files were fetched back from GitHub after commit to verify they exist on the branch.
- No local npm build, lint, Deno check, or runtime integration test has been executed.
- The function deployment attempt was blocked; no new function is deployed.
- Production traffic, DNS, database schema/data/RLS, and existing Lovable fallback remain unchanged.


## Additional batch progress (2026-10-27)

- [x] Added source for `ping-presence` (authenticated heartbeat, derives user/workspace from session/profile).
- [x] Added source for `get-team-presence` (admin-only, workspace-scoped read, optional capped user IDs/results).
- [x] Added source for `get-access-status` using the current subscriptions schema and Free-plan behavior.
- [x] Updated `src/lib/staffTracking.js` on the migration branch to invoke `ping-presence` and `track-staff-action`.
- [ ] Locate and update the actual team-presence UI adapter after the function is deployed and its response is verified.
- [ ] Deploy functions and test authenticated/no-session requests. The deployment tool blocked the earlier deployment attempt; the function sources remain branch-only.

### Original handler details needed from the owner

To finish the next larger batch safely, recover/paste the original Lovable handler code or its exact request/response examples for:

1. `send-team-invite` — role validation, invite-code creation/expiry, email delivery provider, response shape.
2. `verify-invite-code` — whether `allowRebind` permits an existing account to attach to an invite, expiry/used-code rules, and exact success/error response.
3. `manage-workspace-member` — allowed actions/roles, owner/admin restrictions, removal behavior, and exact response.
4. `track-staff-action` — payload fields and how action history is stored.

No guessed invite/member-management handler has been implemented. The existing fallback stays in place.


## Additional batch progress (2026-10-27 — original source received)

- [x] Recovered original contracts for team invites/member management, staff presence/activity, owner-role bootstrap, and PayU.
- [x] Added `supabase/functions/track-staff-action/index.ts` using the current live schema's `created_by` column, authenticated session, Asia/Kolkata daily counters, input validation, and bounded action history.
- [x] Updated `src/lib/staffTracking.js` to call `track-staff-action` instead of returning a no-op.
- [x] Confirmed live schema columns for `profiles`, `workspace_members`, `invite_codes`, `staff_activity`, `subscriptions`, and `payment_logs` via read-only schema inspection.
- [ ] Correct and test the presence functions against actual RLS and duplicate-row behavior.
- [ ] Port team invite/member management using the original source while reconciling current enum/column differences.
- [ ] Port PayU only after reconciling current subscription/payment schema and confirming server-only secrets are configured; no live payment testing.
- [ ] Deploy and run authenticated/no-session tests; deployment has not succeeded, so all branch functions remain source-only.

### Remaining integration safeguards

- Email sending in the original archive depends on `connector-gateway.lovable.dev`; it is not a Lovable-free mail integration. Do not claim email migration complete until a replacement provider is selected/configured and tested.
- Original `frontendBase()` points to the old Netlify hostname; use the current production origin only after validating allowed-origin/redirect rules.
- The original PayU handler stores amounts in paise in some places but receives decimal rupees from PayU callbacks. Reconcile this with the live database before migrating any payment write.
- Current production routes and Lovable fallback remain untouched.


## Original-source migration batch (2026-10-27 — code added, not deployed)

New branch-only files:
- `supabase/functions/_shared/team.ts` — verifies the Supabase user session, creates a server-only service-role client, and resolves the caller's admin workspace scope.
- `supabase/functions/ensure-owner-role/index.ts` — ports owner bootstrap while preventing staff promotion and intentionally omitting the archived 14-day trial behavior (current product uses Free).
- `supabase/functions/send-team-invite/index.ts` — ports invite/member creation, validates staff roles and email, writes activity logs, and returns a shareable code. It explicitly reports `emailSent: false` because the original mail implementation depends on Lovable's connector and is not migrated.
- `supabase/functions/verify-invite-code/index.ts` — ports email matching, expiry/used-code checks, rebind constraints, atomic single-use claim, membership activation, and profile update; only non-admin staff roles are accepted.
- `supabase/functions/manage-workspace-member/index.ts` — ports role change/removal with admin scope and owner protection.
- `supabase/functions/track-staff-action/index.ts` — ports activity history and daily counters using the current `staff_activity.created_by` schema.
- `supabase/functions/get-access-status/index.ts` — ports active subscription access checks while returning no legacy 14-day trial.
- `get-workspace-team` was tightened to admin-only and owner-scoped results.
- `get-team-presence` was tightened to admin-only and now computes ONLINE/IDLE/OFFLINE and resets stale daily counters in the response.
- `ping-presence` now uses Asia/Kolkata calendar dates and selects the most recently updated row if old duplicates exist.
- `src/lib/staffTracking.js` now invokes the staff action Edge Function instead of returning a no-op.

## Current validation state

- Source writes were accepted by GitHub on `h1/migration-inventory`; these are not production changes.
- No Deno executable is available in the current environment, so Edge Function type-checking was not run.
- No local React/Vite build or frontend test was run in this batch.
- Functions have not been deployed or runtime-tested; do not switch frontend API routing yet.
- Team invite emails are intentionally not sent by the new function. A non-Lovable email provider must be configured and tested before email delivery can be marked complete.
- PayU source is recovered, but no PayU functions were changed yet because current live `subscriptions`/`payment_logs` schemas differ from the archive. This remains the next backend migration area after payment schema mapping.


## Batch inventory links

All listed files are on `h1/migration-inventory` and have been fetched back from GitHub after creation/update:

- [Shared workspace helpers](../supabase/functions/_shared/team.ts)
- [Owner bootstrap](../supabase/functions/ensure-owner-role/index.ts)
- [Send team invite](../supabase/functions/send-team-invite/index.ts)
- [Verify invite code](../supabase/functions/verify-invite-code/index.ts)
- [Manage workspace member](../supabase/functions/manage-workspace-member/index.ts)
- [Track staff action](../supabase/functions/track-staff-action/index.ts)
- [Get access status](../supabase/functions/get-access-status/index.ts)
- [Get workspace team](../supabase/functions/get-workspace-team/index.ts)
- [Ping presence](../supabase/functions/ping-presence/index.ts)
- [Get team presence](../supabase/functions/get-team-presence/index.ts)
- [Staff tracking frontend adapter](../src/lib/staffTracking.js)


## Larger H1 batch — business records and PayU (2026-10-27)

Additional branch-only source files now present:

- `supabase/functions/_shared/payu.ts` — PayU plan catalogue, SHA-512 request/reverse hash helpers, transaction IDs, safe paths and trusted return-origin checks.
- `supabase/functions/create-payu-order/index.ts` — authenticated PayU order creation using current `subscriptions` columns and server-side plan prices.
- `supabase/functions/verify-payu-payment/index.ts` — public PayU callback handler; verifies reverse hash, merchant key, amount, order status and single-activation update; logs verification results without storing the hash.
- `supabase/functions/workspace-records/index.ts` — allowlisted workspace-scoped CRUD for clients, quotations, expenses, stock, services, leads and business profile; uses the caller's JWT so existing RLS policies enforce permissions.
- `supabase/functions/list-invoices/index.ts` — workspace-scoped invoice + line-item reader.
- `supabase/functions/save-invoice/index.ts` — calls the server-authoritative `save_invoice` RPC and reloads the saved invoice.
- `supabase/functions/set-invoice-status/index.ts` — calls protected invoice RPCs for Paid/Pending/Cancelled state changes.
- `supabase/migrations/202610270001_h1_invoice_rpcs.sql` — adds the missing invoice RPC definitions adapted to the live schema; it is not applied to the live database.
- `src/api/backendClient.js` routes migrated team/presence/access/PayU/workspace-record/invoice operations to Supabase functions on this branch, leaving unported operations on the existing fallback.
- `src/components/team/useWorkspacePresence.js` now reads the migrated presence endpoint and normalizes the UI's status/elapsed fields.
- Migration CI workflow now triggers on `h1/migration-inventory` and includes Deno checks for the new Edge Functions.

### Live schema findings from read-only Supabase inspection

- Current tables contain the expected invoice/business-record columns and workspace RLS policies.
- Current database does **not** currently expose `save_invoice`, `cancel_invoice`, `delete_draft_invoice`, or `revenue_summary`; only `next_invoice_number` and `apply_invoice_stock` were found among invoice-related functions. The new migration must be reviewed and applied before the invoice Edge Functions can work.
- `get_access_status(p_workspace_id text)` is present and already returns Free-plan state without legacy trials.
- Subscription tiers are `basic`, `pro`, `free`; payment outcomes are `applied`, `failed`, `tampered`; subscription statuses are `created`, `active`, `failed`, `tampered`.
- Existing RLS policies for business tables are already workspace-scoped; generic record access uses the authenticated user's JWT rather than service-role bypass.
- PayU deployment requires server-only Supabase secrets `PAYU_MERCHANT_KEY`, `PAYU_MERCHANT_SALT`, `PAYU_ENV`, and `APP_BASE_URL`. No secret values were copied from the uploaded archive or committed.
- Email delivery still depends on the original Lovable Google Mail connector. The replacement invite function explicitly reports that email was not sent; Gmail/payment-reminder migration remains incomplete until a non-Lovable mail provider is configured.

### Verification status

- All newly added/updated source files were fetched back from GitHub on `h1/migration-inventory`.
- Read-only schema inspection completed; no production schema or data changes were made.
- GitHub combined status currently returns no check statuses for the latest commit; CI has not yet been confirmed as passing.
- Deno checks, frontend build, membership tests, Edge Function deployment, authenticated E2E tests, PayU sandbox test, and invite-email delivery remain unverified.
- Production DNS, deployment, and the current backend fallback remain untouched.
