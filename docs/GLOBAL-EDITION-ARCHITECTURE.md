# Plivex Global — Architecture Foundation (Part 1)

**Status:** Foundation only; not production-ready and not tax/legal-compliance certified.  
**Development branch:** `global-dev`  
**India production branch:** `main`

## 1. Non-negotiable isolation rules

1. `main` remains the source of truth for the existing India product.
2. Global work is developed only on `global-dev`. No Global feature is merged into `main` until the complete edition has passed review and explicit release approval.
3. No Global module may be imported by the India application as part of this foundation.
4. Global configuration must be explicit. Missing, malformed, or unknown edition values must never silently activate Global behavior.
5. Existing India GST calculations, invoice numbering, payment providers, subscriptions, user data, Supabase schema, and production environment must not be changed by Global foundation work.
6. Never put service-role keys, payment secrets, tax credentials, or other private credentials in browser code, committed files, logs, or tests.

## 2. Target architecture

The long-term product is one codebase with a shared business core and country-specific adapters:

- **Shared core:** identity/workspaces, customers, products/services, document lifecycle, permissions, audit events, and common validation.
- **Edition context:** explicit edition identifier and jurisdiction context, resolved at the application boundary.
- **Country adapters:** separate modules for country-specific business identity, tax rules, invoice requirements, numbering, localization, and payment integrations.
- **Presentation:** shared components receive normalized, typed data; country-specific labels and required fields come from edition configuration rather than scattered country checks.
- **Persistence:** jurisdiction-specific fields and effective-dated rule versions must be explicit. Do not assume a single tax schema fits every country.

India GST remains its existing implementation until a separately reviewed migration plan says otherwise. Global work must not reuse India GST calculations as a generic tax engine.

## 3. Separation boundaries

Future modules should follow this conceptual layout (create them only when their contracts are defined):

```text
src/
  global/
    core/             # edition context and stable shared contracts
    countries/        # country adapters; no cross-country implicit fallbacks
    tax/              # versioned jurisdiction rules, separate from GST code
    documents/        # country-aware invoice/document requirements
    payments/         # provider adapters; secrets remain server-side
    localization/     # locale, formats, translations
    tests/            # isolated unit and contract tests
```

This Part 1 adds only the foundation contract and its tests. It does not connect Global to the live UI, database, auth, billing, or deployment.

## 4. Rules for future country/tax work

- Store currency as an ISO 4217 code; never infer currency from a symbol.
- Store monetary values using a documented precision/rounding policy; do not use binary floating-point as the authoritative ledger representation.
- Store tax rule jurisdiction, rule identifier/version, effective-from/effective-to dates, and calculation evidence with each finalized document.
- Distinguish tax registration status, tax type, tax rate, exemptions, reverse-charge behavior, and invoice disclosure requirements.
- Never hard-code a rate as universally applicable. Rates and obligations depend on jurisdiction, date, transaction type, and business registration.
- Use country-specific tests with boundary dates, rounding cases, exempt cases, invalid inputs, and regression fixtures.
- Do not claim legal compliance until each supported jurisdiction's requirements have been researched and independently reviewed.

## 5. Data and security principles

- Tenant/workspace scope must be enforced server-side and by database row-level security; client-side filtering is not authorization.
- Never trust client-supplied totals, tax amounts, roles, subscription state, or payment status.
- Validate all external input at API boundaries.
- Keep secrets in server-side secret stores only.
- Use auditable migrations, additive schema changes, explicit rollback plans, and backups before any production data change.
- Global tests use synthetic fixtures only; never copy production customer data into tests.

## 6. Release gates

Global is not releasable until all applicable gates pass:

1. Architecture and threat-model review.
2. Unit, contract, integration, and regression tests.
3. Production build and static checks.
4. Database migration review, RLS tests, and rollback verification.
5. Payment sandbox verification and webhook idempotency tests.
6. Country-specific tax/document review by qualified local experts.
7. Accessibility, responsive UI, localization, and browser/device tests.
8. Staging deployment and smoke tests.
9. Explicit approval before merging to `main` or deploying to production.

## 7. What Part 1 does and does not prove

Part 1 establishes documented boundaries, a fail-closed edition identifier contract, isolated automated tests, and a branch-specific CI workflow. It does **not** prove the full Global product is bug-free, tax-compliant, secure in production, or ready to deploy. Those claims require the later implementation and verification gates above.
