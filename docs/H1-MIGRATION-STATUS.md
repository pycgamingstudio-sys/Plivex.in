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

## Current blocker

The two canonical Lovable backend source trees could not be identified in connected GitHub repositories. Previously shared handler excerpts are not verified against canonical repositories and some handlers are missing. Missing business logic will not be guessed. Recovering source or approving a written endpoint contract is required before parity can be claimed.

## Verification notes

- Migration inventory and three new Edge Function source files are committed to `h1/migration-inventory`.
- Source files were fetched back from GitHub after commit to verify they exist on the branch.
- No local npm build, lint, Deno check, or runtime integration test has been executed.
- The function deployment attempt was blocked; no new function is deployed.
- Production traffic, DNS, database schema/data/RLS, and existing Lovable fallback remain unchanged.
