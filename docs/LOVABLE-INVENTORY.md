# Lovable Backend Migration Inventory

**Status:** Phase 1 audit only. No application code, database schema, policies, DB functions, data, deployed functions, Netlify settings, PayU settings, or Lovable projects were changed in this phase.

**Repository:** `pycgamingstudio-sys/Plivex.in`  
**Branch:** `remove-lovable`  
**Audit baseline:** `main` at `e898282544734bf3b91ce62d3139f9347add0a80` (observed during audit)

## 1. GitHub source availability

The connected GitHub account currently exposes these three repositories:

- `pycgamingstudio-sys/Plivex.in` — public, the Plivex frontend repository.
- `pycgamingstudio-sys/Driver-saathi-` — public, appears unrelated to this migration.
- `pycgamingstudio-sys/My-builder-` — private; its README describes a personal AI app builder, not either of the two Plivex Lovable backend projects.

**Finding:** Neither of the two Lovable backend project repositories could be identified among the repositories accessible to this session. No backend source was ported or reconstructed by guessing. This is an access/identification finding, not proof that no repository exists in the GitHub account.

### What is needed to expose the original source

For **each** Lovable backend project:
1. Open that project in Lovable.
2. Open the project **Settings** and find the **GitHub** integration / repository connection section (the exact label may vary with the current Lovable UI).
3. If the project is already connected, note the exact GitHub owner/repository name and ensure the connected GitHub account/session used for this work has read access.
4. If it is not connected, use Lovable's GitHub connect/sync flow to connect the project to a repository. Do not disconnect, overwrite, pause, or delete the live Lovable project.
5. If Lovable cannot connect it, export/download the project source from the project UI if that option is available, then upload the source ZIP here or push it to a new private GitHub repository. Include server-side files, not only the frontend.

Expected source paths to look for, based on the task description: `src/routes/api/public/*`, `handlers.server.ts`, `business.server.ts`, and `config.server.ts`. These files were **not verified** because neither backend repository was identified.

## 2. Frontend API wiring observed

### `src/api/backendClient.js`

- Reads `VITE_API_BASE_URL`; if unset, falls back to `https://member-sync-flow.lovable.app`.
- Builds business API calls as `POST <base>/api/public/<kebab-name>`.
- Adds `Authorization: Bearer <Supabase access token>` when a session token exists.
- Sends JSON and parses a JSON response.
- On non-2xx, throws `ApiError`; it retains `status`, `operation`, `requestId` when supplied by the response, but response-shape compatibility must be verified against original backend code.
- Contains adapters for `verifyInviteCode`, `sendTeamInvite`, and `getWorkspaceTeam`.
- Auth login/register/password reset use Supabase Auth directly, not the Lovable `/api/public` endpoint.
- `StaffActivity`, `WorkspaceMember`, and `Subscription` entity adapters are currently inert (empty/no-op methods).
- Image upload currently resizes a file to an inline PNG data URL; this is not a server storage endpoint.

### Environment configuration observed

- `.env.example` documents `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_API_BASE_URL=https://member-sync-flow.lovable.app`.
- `VITE_ASSISTANT_API_BASE_URL` was not found in `.env.example` or in the inspected active assistant component. Do not assume it is still used by the current branch until the complete source search is repeated.
- `src/components/AssistantWidget.jsx` calls Supabase Edge Function `assistant-chat` directly using `supabase.functions.invoke`, rather than using the `backendClient.js` Lovable endpoint helper.

## 3. Endpoint inventory supplied for this migration

The names below are the required compatibility targets from the task request. Original request schemas, response bodies, status codes, and error behavior remain **unverified** until the two original backend projects' source is available. Duplicate endpoint implementations must be compared before selecting one canonical implementation.

| Endpoint | Phase | Current audit note |
|---|---|---|
| `ensure-owner-role` | 2 — auth/team | Original handler not yet available |
| `send-team-invite` | 2 — auth/team | Frontend adapter exists as `sendTeamInvite`; original handler not yet available |
| `verify-invite-code` | 2 — auth/team | Frontend adapter exists as `verifyInviteCode`; original handler not yet available |
| `get-workspace-team` | 2 — auth/team | Frontend adapter exists as `getWorkspaceTeam`; original handler not yet available |
| `manage-workspace-member` | 2 — auth/team | Original handler not yet available |
| `create-payu-order` | 5 — PayU | Original handler not yet available |
| `verify-payu-payment` | 5 — PayU | Original handler not yet available |
| `get-access-status` | 2 — access/subscription | Original handler not yet available |
| `save-invoice` | 3 — invoice/data | Original handler not yet available |
| `set-invoice-status` | 3 — invoice/data | Original handler not yet available |
| `delete-invoice` | 3 — invoice/data | Original handler not yet available |
| `list-invoices` | 3 — invoice/data | Original handler not yet available |
| `get-business-summary` | 3 — invoice/data | Original handler not yet available |
| `workspace-records` | 3 — invoice/data | Original handler not yet available |
| `business-logo` | 3 — invoice/data | Original handler not yet available |
| `send-payment-reminder` | 4 — email/reminders | Original handler not yet available |
| `assistant-chat` | 6 — AI assistant | One Supabase Edge Function is already deployed and active; source compatibility and behavior still require audit |
| `assistant-confirm` | 6 — AI assistant | No separate deployed function was visible in the Supabase function listing; original handler not yet available |

## 4. Supabase snapshot observed

Project ref: `sqzpaiibmfsvarrkwkvb`.

The Supabase Edge Function listing returned one active function: `assistant-chat` (JWT verification enabled). No other function from the required endpoint list appeared in that listing at audit time.

No database operation was performed for this inventory. The schema, RLS policies, database function `next_invoice_number`, and existing data were not changed in Phase 1.

## 5. Supplemental core-logic archive received

The uploaded `plivex-core-logic.zip` contains:

- `supabase/functions/_shared/logic.mjs` — invoice/GST calculation, PayU hash/callback helpers, plan amounts, calendar period, invite-code, and India-date helpers.
- `supabase/functions/_shared/logic.test.mjs` — Node test cases for these helpers.
- `README.md` — says to run tests with `node --test supabase/functions/_shared/logic.test.mjs`.

This archive was inspected but **not copied into the repository and its tests were not run** in Phase 1. Before use in a later phase, each rule must be checked against the exact requirements and original backend behavior. In particular, helper-level tests alone do not verify database permissions, concurrency, or real PayU integration.

## 6. Non-negotiable compatibility and safety checks for later phases

Use the task's stated requirements as acceptance criteria; validate them against original source before implementation:

- Keep the endpoint names, input/output contracts, HTTP status codes, and error object shape `{ error, status, operation, requestId }`.
- Restrict CORS to `https://plivex.in`, `https://www.plivex.in`, and `https://plivex.netlify.app`.
- Derive user, workspace, and role from a verified Supabase token and database, never trust client-supplied identity fields.
- Do not expose service-role credentials to the frontend. Secrets are set by the project owner in the Supabase dashboard; no secret values belong in this repo.
- Do not change tables, columns, RLS, DB functions, or data without showing the proposed SQL, rollback/backup approach, and waiting for explicit approval.
- Keep PayU tests in test mode only (`PAYU_ENV=test`); no live keys/salts or real-money tests.
- Keep assistant actions as proposals until the separate confirmation path authorizes execution.
- Do not merge to `main`, switch production traffic, or pause/delete either Lovable project without explicit owner approval.

## 7. Phase 1 completion criteria and blockers

- [x] Inspect accessible GitHub repositories and identify whether both Lovable source repos are available.
- [x] Inspect the Plivex API client, environment example, assistant component, and current Supabase Edge Function list.
- [x] Inspect the supplied core-logic archive.
- [x] Record endpoint list, known wiring, source gaps, and safe export/repository steps.
- [ ] Obtain access to or source exports from both original Lovable backend projects.
- [ ] Compare duplicate endpoint handlers and record exact request/response/error contracts.

**Phase 1 result:** The inventory can be committed now, but porting must wait for the two original backend source trees. Recreating handlers without those trees would violate the instruction not to guess business logic.
