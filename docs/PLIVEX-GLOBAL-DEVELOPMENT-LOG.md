# Plivex Global Development Log

**Working branch:** `global-dev`  
**India production branch:** `main` (not modified)  
**Current status:** Part 1 remediation committed for independent testing; not approved or release-ready.

## Repository and architecture guardrails

- Repository: `pycgamingstudio-sys/Plivex.in`; production branch remains `main`.
- React 18 + Vite + Tailwind frontend; Supabase Auth, Postgres/RLS and Edge Functions backend; Cloudflare deployment workflow exists.
- India remains the default edition. Global country identity registry is separate and explicitly identity-only; country selection requires confirmation.
- Shared `plan_features` and `plan_limits` currently have no edition discriminator. Do not apply edition-specific entitlement changes to these shared tables.
- No production deployment, DNS change, live Supabase migration, payment transaction or production data change is authorized by this work.

## Part 1 remediation

### 1. Shared Basic-plan migration
- Replaced the unsafe shared Basic lead-entitlement mutation with an intentional no-op and documented why.
- This preserves existing India and Global entitlement behavior until the database has an edition-aware plan catalogue.
- Important limitation: this is safe for an unapplied migration in the development branch. If that migration was already applied to a live database, a separately reviewed compensating migration would be required; this work did not inspect or mutate live database state.

### 2. Public invoice data minimization and workspace integrity
- Public invoice query now selects only invoice item fields rendered by the public page: `id`, `description`, `quantity`, and `rate`.
- Invoice fetch additionally requires the invoice workspace to match the workspace stored on the share-link record.
- Public response continues to use no-store cache headers.

### 3. Public share-link rate limiting
- Added a service-role-only Postgres RPC and private RLS-enabled counter table.
- Public invoice views are limited to 60 requests per share link per minute; tracking actions to 30 per share link per minute.
- The Edge Function fails closed with 503 if the rate-limit RPC is unavailable and returns 429 when a limit is exceeded.
- Rate limits are per share link, not per source IP. This bounds counter inflation for a link but is not a full distributed IP/WAF abuse-control system.

### 4. Currency and locale handling
- Added CAD, AUD and SGD to the existing invoice currency catalogue, aligning it with the seven country registry currencies.
- Currency formatting and amount-in-words now reject unsupported currency codes rather than silently displaying INR.
- Added explicit currency locale lookup and locale-aware formatting for public invoice and share-management dates.
- Assistant invoice confirmation now accepts only the supported currency allowlist and still defaults omitted currency to INR. Existing server-side plan enforcement remains responsible for restricting non-INR invoice creation where applicable.

### Automated coverage added
- Added Global tests asserting all country registry currencies are supported, new currency formatting works, unknown currencies fail explicitly, and amount-in-words uses the expected minor-unit names.
- Chat 2 must run the full test, lint, typecheck and build suite. No test pass is claimed by this implementation report.

## Changed files

- `supabase/migrations/202611130001_basic_plan_lead_management.sql`
- `supabase/migrations/202611130003_invoice_share_rate_limit.sql` (new)
- `supabase/functions/invoice-share/index.ts`
- `supabase/functions/assistant-confirm/index.ts`
- `src/lib/currency.js`
- `src/pages/PublicInvoicePage.jsx`
- `src/pages/InvoiceShareManagement.jsx`
- `src/global/tests/currency.test.mjs` (new)
- `docs/PLIVEX-GLOBAL-DEVELOPMENT-LOG.md`

## Verification and limitations

- Changes are limited to `global-dev`.
- No live database migration was run; no RLS policy was applied to a live Supabase project.
- No Edge Function was deployed or runtime-tested against Supabase.
- No test, lint, typecheck or build command was executed by Chat 1 after these edits. Chat 2 must execute them and fix any failures before Chat 3 re-audits.
- The invoice item column names are consistent with the existing public UI data contract; Chat 2 should verify the actual deployed schema/migration history without changing live data.
- The rate limit is per share link; add platform-level IP/WAF controls separately before public high-volume launch.
- Currency support is display/catalogue compatibility only. It does not implement FX conversion, country tax rules, localized legal invoice requirements, or currency-safe ledger arithmetic.
- If the Basic-plan migration has already been applied in any environment, do not assume editing the migration file reverses it; inspect migration history and prepare a separately approved compensating migration.

## Handoff to Chat 2

1. Verify branch head and changed-file list.
2. Run `npm ci`, `npm run test:membership`, `npm run test:global`, `npm run lint`, `npm run typecheck`, and `npm run build`.
3. Review SQL syntax and Edge Function type/runtime behavior; do not apply migrations or deploy functions.
4. Verify India default behavior, INR formatting, invoice sharing and plan-entitlement regression risks.
5. Fix failures only on `global-dev`, rerun all checks, and report exact evidence and final commit SHA.
6. Do not start Part 2; Chat 4 approval remains mandatory.


## Part 1 re-audit remediation (Chat 3 findings)

- Invoice-share CORS now accepts only the exact configured Plivex origins already present in the function: `https://plivex.in`, `https://www.plivex.in`, and `https://plivex.netlify.app`. The broad `pages.dev` / `workers.dev` hostname patterns were removed. No unverified staging hostname was added.
- Currency tests now independently assert the expected locale mapping for each registered currency and use fixed known outputs for CAD, AUD and SGD. The expected locale values are declared in the test rather than derived from `getCurrencyLocale()`.
- Assistant invoice validation now accepts only the supported currency allowlist and preserves the selected currency in both deterministic invoice drafts and model-generated invoice snapshots. A supplied snapshot's currency is normalized to the validated action currency so the payload and snapshot cannot disagree. Omitted currency remains INR for backward compatibility.
- Rate limiting remains per share-link and per action (60 public views/minute; 30 tracking events/minute). It is a basic abuse bound, not IP-level or WAF-level protection; distributed abuse and link-level denial-of-service remain residual risks.
- Static SQL review was repeated for migrations `202611130002_invoice_share_links.sql` and `202611130003_invoice_share_rate_limit.sql`: the share-link table references `public.invoices(id)` and `auth.users(id)`; the rate-limit table references `public.invoice_share_links(id)`; both tables enable RLS and revoke direct public-role access; security-definer functions use fixed search paths and service-role-only execute grants. Repository-visible schema evidence is insufficient to prove the deployed `invoices.id`, `invoices.workspace_id`, and related foreign-key types match these declarations. No live or disposable database was available/executed, so runtime migration compatibility and effective RLS behavior remain unverified. Do not treat this static review as migration approval.
- No migration was applied, no Edge Function was deployed, and no production/main branch, DNS, or live database was changed.

### Files changed in this remediation round

- `supabase/functions/invoice-share/index.ts`
- `src/global/tests/currency.test.mjs`
- `supabase/functions/assistant-chat/index.ts`
- `docs/PLIVEX-GLOBAL-DEVELOPMENT-LOG.md`

### Verification handoff

- Chat 1 has not executed npm/deno tests, lint, typecheck, or build for these new commits. Chat 2 must run the full required checks against the latest `global-dev` HEAD and inspect the assistant Edge Function diff.
- Chat 3 must independently re-audit the resulting exact commit, including the CORS origin matrix, currency tests, assistant payload/snapshot consistency, and migration/schema limitations.
- Part 1 remains unapproved until Chat 4 explicitly approves it. Do not begin Part 2.
