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
- Presence/activity endpoints reported in the supplied backend inventory: `ping-presence`, `track-staff-action`, `get-team-presence`

### Business data
- `save-invoice` / invoice save flow
- `set-invoice-status`
- `delete-invoice`
- `list-invoices`
- `get-business-summary`
- `workspace-records`
- `business-logo`
- Client, quotation, expense, stock, service, lead CRUD/read operations discovered by full frontend call-site mapping

### Payments and messaging
- `create-payu-order`
- `verify-payu-payment`
- `send-payment-reminder`
- Gmail/email integration currently has a reported dependency on Lovable's connector gateway and must be replaced only after choosing and testing a supported mail provider.

### AI
- `assistant-chat`
- `assistant-confirm`

## Known compatibility and safety requirements

- Preserve existing request/response shapes, HTTP status behavior, and frontend expectations; verify these against the original server handlers before porting.
- Derive user and workspace identity from a verified Supabase session and database; never trust client-provided workspace/role IDs.
- Keep service-role credentials server-side only.
- Keep PayU tests in sandbox/test mode; no real-money tests.
- Do not modify schema, RLS, database functions, or user data without a separate reviewed SQL plan and explicit approval.
- Keep the Lovable fallback in place until each replacement is implemented and tested.
- Do not merge this branch, change production routing, alter DNS, or pause/delete Lovable projects without explicit approval.

## H1.1 checklist

- [x] Inspect active frontend API adapter and assistant call sites.
- [x] Snapshot currently deployed Supabase Edge Functions.
- [x] Record known endpoint families and current Lovable fallback.
- [x] Inspect team membership and presence call sites.
- [x] Confirm presence functions are currently no-op and staff activity entity adapter is inert.
- [ ] Complete exhaustive call-site mapping across all `src/` files.
- [ ] Obtain/verify canonical source for both original Lovable backend projects and compare exact contracts.
- [ ] Mark each endpoint as migrated only after runtime tests.

## Additional frontend call-site findings (main branch snapshot)

- Team UI invokes `sendTeamInvite`, `manageWorkspaceMember`, `getWorkspaceTeam`, `ensureOwnerRole`, and `verifyInviteCode` through the compatibility adapter. The frontend expects a versioned membership response with members, role/status counts, and the matching workspace ID.
- Presence UI calls `pingPresence`, while `trackStaffAction` is defined but no-op. Team presence also reads `db.entities.StaffActivity`, whose adapter is currently inert. This means presence UI cannot be considered migrated/functional just because a function name is known.
- `stores.js` documents server-backed invoices, clients, quotations, expenses, leads, stock, services, and business profile. These writes/reads need an operation-by-operation mapping and verification; the shared store file is not itself proof every backend endpoint works.
- Current `backendClient.js` converts function names to kebab-case and posts to the Lovable API for all calls except `add-client`. This remains the primary fallback removal point after endpoint replacements pass tests.
- The active repository snapshot includes `.env` with Lovable base URLs, while `.env.example` is the documented template. Do not commit credentials or make a production environment change as part of inventory.

## Current blocker

The original inventory notes that the two canonical Lovable backend source trees were not identifiable in the connected GitHub repositories. Several backend excerpts were previously supplied in chat, but they are not verified against canonical repositories and some handlers are still missing. Porting those missing handlers by guessing business logic would be unsafe. This does not block the frontend call-site inventory, but it blocks declaring full migration parity until source contracts are recovered or individually approved specifications are documented.

## Verification notes

- The inventory document was committed to this branch only.
- No GitHub Actions run was found for this new inventory branch at the time checked.
- No local npm build, lint, or runtime integration test has been executed for this branch.
- Production traffic and the existing Lovable fallback remain unchanged.
