# H1 Backend Migration — Part 1 Inventory

**Branch:** `h1/migration-inventory`  
**Status:** Inventory/audit in progress. No production routing, DNS, database schema, RLS policies, data, or live deployment changed.

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

Active status alone does not prove endpoint behavior is correct. Existing assistant-chat logs previously showed POST failures with HTTP 502 due to a Gemini model 404; AI runtime verification remains outstanding.

## Required endpoint families

### Auth, workspace, and team
- `ensure-owner-role`
- `send-team-invite`
- `verify-invite-code`
- `get-workspace-team`
- `manage-workspace-member`
- `get-access-status`
- Presence/activity endpoints: `ping-presence`, `track-staff-action`, `get-team-presence`

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
- Email integration currently has a reported dependency on Lovable's connector gateway and must be replaced only after choosing and testing a supported mail provider.

### AI
- `assistant-chat`
- `assistant-confirm`

## H1.2 implementation in progress

- [x] Inspect RLS policies for `profiles`, `workspace_members`, and `invite_codes`.
- [x] Confirm `profiles` read is limited to the signed-in user's own row.
- [x] Confirm `workspace_members` read is scoped to the authenticated user's workspace and membership/ownership.
- [x] Add an initial authenticated read-only `get-workspace-team` Edge Function source file on this branch: `supabase/functions/get-workspace-team/index.ts`.
- [ ] Deploy the new function to Supabase.
- [ ] Verify no-session request returns 401 and authenticated owner/member request returns only their permitted workspace rows.
- [ ] Route frontend `getWorkspaceTeam` call to the function only after runtime tests pass.
- [ ] Continue with invite verification and member management after confirming original endpoint contracts.

The deployment attempt was blocked by the available tool's safety checks, so the new function has **not** been deployed and is not in production use.

## Known compatibility and safety requirements

- Preserve existing request/response shapes, HTTP status behavior, and frontend expectations; verify these against the original server handlers before porting.
- Derive user and workspace identity from a verified Supabase session and database; never trust client-provided workspace/role IDs.
- Keep service-role credentials server-side only.
- Keep PayU tests in sandbox/test mode; no real-money tests.
- Do not modify schema, RLS, database functions, or user data without a separate reviewed SQL plan and explicit approval.
- Keep the Lovable fallback in place until each replacement is implemented and tested.
- Do not merge this branch, change production routing, alter DNS, or pause/delete Lovable projects without explicit approval.

## Additional frontend call-site findings (main branch snapshot)

- Team UI invokes `sendTeamInvite`, `manageWorkspaceMember`, `getWorkspaceTeam`, `ensureOwnerRole`, and `verifyInviteCode` through the compatibility adapter. The frontend expects a versioned membership response with members, role/status counts, and the matching workspace ID.
- Presence UI calls `pingPresence`, while `trackStaffAction` is defined but no-op. Team presence also reads `db.entities.StaffActivity`, whose adapter is currently inert. This means presence UI cannot be considered migrated/functional just because a function name is known.
- `stores.js` documents server-backed invoices, clients, quotations, expenses, leads, stock, services, and business profile. These writes/reads need an operation-by-operation mapping and verification; the shared store file is not itself proof every backend endpoint works.
- Current `backendClient.js` converts function names to kebab-case and posts to the Lovable API for all calls except `add-client`. This remains the primary fallback removal point after endpoint replacements pass tests.
- The active repository snapshot includes `.env` with Lovable base URLs, while `.env.example` is the documented template. Do not commit credentials or make a production environment change as part of inventory.

## Current blocker

The original inventory notes that the two canonical Lovable backend source trees were not identifiable in the connected GitHub repositories. Several backend excerpts were previously supplied in chat, but they are not verified against canonical repositories and some handlers are still missing. Porting those missing handlers by guessing business logic would be unsafe. This does not block the frontend call-site inventory, but it blocks declaring full migration parity until source contracts are recovered or individually approved specifications are documented.

## Verification notes

- H1.1 inventory and initial H1.2 function source are committed to the migration branch only.
- No GitHub Actions run was found for this branch at the time checked.
- No local npm build, lint, or runtime integration test has been executed for this branch.
- The new `get-workspace-team` function deployment was blocked by tool safety checks and remains undeployed.
- Production traffic and the existing Lovable fallback remain unchanged.
