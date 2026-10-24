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


## 8. Source excerpts received in chat (not yet verified against either live backend repository)

The user has supplied these original-source excerpts from the builder AI in chat:

- `src/lib/ensure-owner-role.functions.ts`
- `src/lib/team.server.ts`
- `src/lib/team.functions.ts` (send-team-invite, verify-invite-code, get-workspace-team, manage-workspace-member)
- `src/lib/plans.ts`
- `src/lib/payu.server.ts`
- `src/lib/payments.functions.ts` (create-payu-order, get-access-status)
- `src/routes/api/public/payu/verify.ts`
- `src/lib/gmail.server.ts`
- `src/lib/email.functions.ts`
- `src/lib/presence.functions.ts` (ping-presence, track-staff-action, get-team-presence)
- `src/integrations/supabase/client.server.ts`
- `src/integrations/supabase/auth-middleware.ts`
- `drizzle/migrations/0005_phase6i_business_data.sql` (tables, RLS policies, invoice RPCs, logo storage policies)

These are chat-provided excerpts, not yet checked against the canonical backend repository, and they have not been copied into production or deployed. The SQL excerpt is substantially present in chat, but must be compared to the actually applied schema before anyone considers running it. **Do not execute this migration against the existing Supabase project** under the no-DB-changes constraint.

### Follow-up audit flags from supplied excerpts

- `gmail.server.ts` calls `https://connector-gateway.lovable.dev/google_mail/gmail/v1` and requires `LOVABLE_API_KEY` plus `GOOGLE_MAIL_API_KEY`; email remains Lovable-dependent until replaced with a selected non-Lovable mail provider and tested.
- The supplied PayU `allowedHosts()` permits any `*.lovable.app` origin and includes `plivex.netlify.app`, rather than enforcing only the required allowlist (`https://plivex.in`, `https://www.plivex.in`, `https://plivex.netlify.app`). Must be tightened in the Edge Function port.
- `createPayuOrder` stores a return origin/path and constructs a callback from `APP_BASE_URL`; callback routing and redirect allowlists need explicit compatibility tests.
- `fetchPdf()` validates HTTPS but follows redirects without re-validating each redirect target; review for SSRF and enforce safe destinations/redirect handling before porting.
- The supplied `save_invoice` RPC performs stock deduction using `GREATEST(0, quantity - qty)`, which prevents negative stock but can silently clamp insufficient stock to zero. Document and test this behavior; do not change the DB function without the required SQL proposal and explicit approval.
- The supplied SQL is a migration definition, not proof that these tables/policies/functions are currently installed. No SQL has been executed.

### Remaining source gaps

The excerpts received so far do not include complete implementations for `set-invoice-status`, `delete-invoice`, `list-invoices`, `get-business-summary`, `workspace-records`, `business-logo`, the original backend variant of `assistant-chat`, or `assistant-confirm`. Frontend wiring, tests, configuration, and any remaining files from the two backend projects also need to be received/verified.

### Updated progress

- [x] Receive a substantial set of backend source excerpts in chat.
- [ ] Verify excerpts against canonical source repositories.
- [ ] Receive/locate all remaining endpoint handlers and configuration.
- [ ] Port only verified logic to the `remove-lovable` branch and run tests.
- [ ] Deploy/test non-production Edge Functions and document secret names.
- [ ] Keep production traffic and Lovable projects unchanged pending explicit cutover approval.
