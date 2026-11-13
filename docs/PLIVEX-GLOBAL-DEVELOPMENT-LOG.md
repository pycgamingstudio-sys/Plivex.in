# Plivex Global Development Log

**Working branch:** `global-dev`  
**India production branch:** `main` (not modified)  
**Current status:** Foundation and first localization utility increment; not a complete international SaaS and not release-ready.

## Repository audit baseline

- Repository: `pycgamingstudio-sys/Plivex.in`; default branch is `main`.
- Audited branch head before this increment: `b44f730b38fc0317469eada7bc610690ae06a719`.
- Stack: React 18 + Vite + Tailwind; Supabase Auth, Postgres/RLS and Edge Functions; Cloudflare deployment workflow exists.
- Frontend backend adapter still contains a Lovable API fallback for unmigrated operations. Auth is Supabase Auth. Several entity adapters remain inert (StaffActivity, WorkspaceMember, Subscription).
- Billing/payment source includes provider-specific India-oriented paths and additional Cashfree/PhonePe Edge Function sources. Their existence does not prove complete Global payment support or successful runtime configuration.
- Database migrations include invoice, plan-limit, subscription and reminder work. No Global country/tax schema or RLS migration is present in this increment.
- The India GST application remains the existing implementation. The Global foundation is isolated under `src/global` and is not imported by the India app.
- The repository includes country-selection identity foundations and CI tests, but no Global onboarding UI, workspace-country persistence, generalized tax engine, international invoice workflow, global subscription catalogue, or country-specific payment adapters.

## Roadmap

1. **Foundation and isolation:** edition contracts, country registry/selection, explicit locale/currency formatting, isolated tests and CI.
2. **Workspace onboarding:** country and locale confirmation, server-authoritative workspace jurisdiction, safe migration and RLS design.
3. **Money and documents:** currency-safe ledger representation, invoice/quotation data contracts, country-specific document requirements.
4. **Tax adapters:** jurisdiction-specific, versioned tax rules with effective dates, calculation evidence and independent local compliance review.
5. **International billing:** plan catalogue, pricing currency, payment-provider adapters, webhook verification and idempotency.
6. **Operational integration:** shared UI integration, localization, data export, auditability, support and observability.
7. **Release readiness:** India regression suite, security/RLS review, sandbox and staging verification, independent audit and explicit release approval.

Phases 2–7 are not claimed complete. They require staged implementation and verification; no production schema, secrets, payment settings, DNS, or deployment are changed by this increment.

## Completed in this increment

### Locale-aware display formatting
- Added `src/global/localization/number-format.js`.
- Added explicit-locale currency and quantity formatting using the platform Intl APIs.
- Requires explicit ISO-style currency code and BCP 47 locale; rejects malformed inputs and non-finite amounts.
- Accepts BigInt for integer currency amounts.
- Performs display formatting only: no arithmetic, exchange conversion, tax calculation, or ledger storage.

### Automated coverage
- Added `src/global/tests/number-format.test.mjs` for USD/EUR/INR/JPY display, explicit locale behavior, BigInt, invalid inputs and precision bounds.
- Existing Global country-selection and edition-contract tests remain in place.
- The Global CI workflow runs `npm ci`, India membership regression tests, Global tests and the production build on `global-dev`.

## Commits

- `e576c4dc59e7551290a67a164d25690b8ee48a06` — `feat(global): add explicit locale-aware number formatting`
- `87e68cc6c5831ca803cf24ea3bf1c6401630006b` — `test(global): cover locale-aware currency and number formatting`

## Verification

- Repository and branch metadata inspected through GitHub.
- Source files and architecture docs fetched from `global-dev`.
- Automated tests were added but have not been executed in a local runtime in this session.
- Global Foundation CI is expected to run on each branch push; its result must be checked before this increment can be marked verified.
- No live Supabase migration, RLS change, Edge Function deployment, payment transaction, Cloudflare deployment, or production traffic change was performed.

## Remaining issues / release blockers

- No country-specific tax rules or tax-compliance certification.
- No server-authoritative workspace jurisdiction selection or onboarding integration.
- No Global invoice/document compliance implementation.
- No general ledger-safe decimal/minor-unit storage layer or currency conversion service.
- No verified international pricing/subscription/payment architecture; existing India/provider flows must not be assumed globally usable.
- Lovable fallback and inert entity adapters remain known backend gaps.
- Supabase migrations/RLS and Edge Function runtime behavior require review and environment-backed tests before integration.
- Tax, invoicing, and payments need per-country requirements research and qualified local review.

## Handoff to Chat 2 — Testing & Fixing Engineer

1. Check the latest `Global Foundation CI` run for `global-dev`. It must show success for `npm ci`, `npm run test:membership`, `npm run test:global`, and `npm run build`.
2. If CI fails, reproduce and fix only failures introduced by this increment; rerun the full workflow.
3. Add edge cases for locale validation, unusual currency fraction digits, negative/large values and browser runtime support.
4. Review that the module is not imported by the India edition and that India membership tests remain green.
5. Report exact run URL, commit SHA, failing/passing commands and any defects. Do not merge, deploy, change database state, or mark Global tax/payment functionality complete.
