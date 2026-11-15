# Part 8 — Complete Country Intelligence & Localization Engine

Status: implementation in progress. This document records the initial source audit and the release contract. It is not a claim of country tax/legal compliance.

## Product contract

- One application and canonical domain: https://plivex.in.
- Workspace country is authoritative and must be resolved server-side.
- Seven initial country identities: IN, US, GB, AE, CA, AU, SG.
- India remains on its existing GST, invoice, payment and data paths.
- Non-India workspaces must not inherit India-only labels, tax fields, examples, payment assumptions or formatting.
- Country identity, locale, currency display, tax capability, legal registration and payment-rail availability are separate concerns.
- Unsupported or unverified capabilities fail closed; drafts may remain available where safe.
- Existing workspace country changes remain review-gated; never rewrite historical documents or silently convert ledger currency.

## Initial repository audit (main @ a05a24e8ea139ebe182c194bcf886f250f3ed081)

### Existing foundations found

- `src/global/countries/country-registry.js`: seven countries, ISO codes, default currencies, phone prefixes and locale choices.
- `src/global/core/edition-contract.js`: workspace country-to-edition resolution; India is explicitly separated.
- `src/global/localization/number-format.js`: locale-aware number/currency formatting foundation.
- `src/global/tax/global-tax-capabilities.js`: conservative capability matrix; India legacy, UK standard VAT baseline, UAE/Australia/Singapore standard-rate calculation baseline, US/Canada require jurisdiction verification.
- `src/global/tax/tax-invoice-formats.js`: country tax invoice labels and seller fields; metadata is not legal certification.
- `src/pages/Register.jsx`: country/locale required at signup (previously merged).
- `src/pages/BusinessProfile.jsx`: country settings and some Global-only field hiding.
- `src/pages/Home.jsx`: Global invoice path is present; this Part now hides India-only UPI/HSN controls for non-India workspaces and uses the country registration label. Remaining invoice/PDF assumptions still need audit.
- `src/pages/TaxSummary.jsx`: this Part now renders a country capability summary for Global workspaces instead of India CGST/SGST/IGST and GSTR-1 UI.
- `src/components/invoice/designs.jsx`: this Part now uses the country registration label and suppresses HSN/SAC display for Global invoice snapshots.
- `src/pages/ClientDatabase.jsx`: this Part now uses the selected country registration label and phone prefix.
- `src/pages/HelpCenter.jsx`: this Part now uses generic Global setup/tax/document guides and hides the India-only support phone number.
- `src/pages/GuestDashboard.jsx`: this Part removes India-specific demo customers, rupee amounts and GST-only marketing copy from the public preview.
- `src/pages/Dashboard.jsx`: this Part avoids applying the India GSTR-1 paywall gate to Global tax summary navigation.
- `src/lib/i18n.js`: existing translation infrastructure requires coverage review.
- Global country, invoice, tax, India regression, workspace isolation and onboarding tests already exist under `src/global/tests`.

### Initial gaps to investigate and close

1. Trace selected signup country through auth provisioning into the persisted workspace; prove there is no silent India fallback.
3. Audit every routed page, shared component, PDF/document renderer, email/share template, AI prompt/function and backend Edge Function for India-only assumptions.
4. Centralize workspace context and country adapter selection; remove scattered country checks only where safe and covered by tests.
5. Complete locale catalogs and right-to-left behavior for Arabic, plus fallback rules that never change the workspace's country or currency.
6. Audit currency precision, date/time zone, decimal/group separators, phone/address/postal formats, units and invoice numbering independently.
7. Separate country tax capability from country selection and seller registration. Do not enable unverified US state/local or Canadian province/territory tax rules.
8. Audit payment providers, subscription display currency and checkout currency separately; provider activation is not implied by a country selector.
9. Add a seven-country UI/API/document test matrix and India regression gate.
10. Verify workspace isolation, RLS, server-side authorization and historical snapshot preservation.
11. Stage and smoke-test before any production rollout; no production schema/data mutation is part of this audit commit.

## Country audit matrix

| Area | IN | US | GB | AE | CA | AU | SG |
|---|---|---|---|---|---|---|---|
| Identity / locale / currency | Preserve India | Audit | Audit | Audit + RTL | Audit + French | Audit | Audit multilingual |
| Tax profile | GST legacy | State/local rules | VAT | VAT | GST/HST/PST/QST | GST/ABN | GST |
| Invoice / PDF | Preserve GST | Sales tax format | VAT format | VAT + Arabic | Province tax format | GST format | GST format |
| Address / phone | India | US | UK | UAE | Canada | Australia | Singapore |
| Payments | Preserve India rails | Verify providers | Verify providers | Verify providers | Verify providers | Verify providers | Verify providers |
| AI / reports / notifications | Preserve India | Country context | Country context | Country + Arabic | Country + French | Country context | Country + locale |

## Acceptance gates

- No India-specific UI leakage in any of the six non-India workspaces, except explicitly documented neutral/shared content.
- No Global-specific changes regress India behavior.
- Workspace country and locale are persisted and resolved server-side.
- Currency display is correct and never mistaken for FX conversion.
- Tax calculation/issuance is enabled only for independently verified jurisdiction capabilities.
- All country-specific documents preserve immutable issue-time snapshots.
- Seven-country tests, India regression tests, build, lint and relevant database/RLS tests pass.
- No claim of launch readiness until staging smoke tests and production deployment verification are complete.


## Part 8 implementation hardening in this branch

- Added a single immutable presentation profile for IN, US, GB, AE, CA, AU and SG. It supplies regional business-registration labels, address labels, document terminology, default locale and time-zone policy; it is not a tax-law rules engine.
- Added explicit-locale date and currency formatting. Date-only values retain their calendar day across time zones. Global invoice previews/PDFs and public invoice copies use saved workspace locale metadata.
- Public About/Features copy now distinguishes India-only features from staged Global capabilities instead of presenting Indian GST features as universal.
- Public Privacy/Terms copy now describes country-dependent features and tax registration information rather than claiming GST-only service; the legal text still requires qualified legal review before launch.
- Global invoice PDFs use the selected country's tax name and registration label (for example Sales tax / sales-tax permit in the US, GST/HST/PST/QST in Canada, VAT in the UK/UAE, GST in Australia/Singapore). Public invoice copies no longer hard-code GSTIN for non-India workspaces.
- Account activity and reports use workspace regional formatting where the data source is available.
- Unsupported India-only tools (shared invoice-link manager, local usage reports, quick templates, local payment logs, service catalog and team management) fail closed for Global workspaces with a clear route back to Global invoices. This avoids showing India GST/INR defaults or disconnected local-only data as if it were Global functionality.
- India tax, UPI, GST controls and existing India invoice paths remain separated.

## Explicit release limitations

- This branch does **not** provide complete translated interface catalogs for Spanish, Arabic, French, Chinese, Malay or Tamil. Global UI remains English; India retains its existing English/Hindi support. The selected locale currently controls regional number/date formatting, not UI translation. Arabic RTL is not claimed.
- US, Canada and Australia need a persisted workspace time-zone selector before local wall-clock time can be shown. Until then, multi-zone date-time display uses explicitly labeled UTC fallback; this is not equivalent to full time-zone onboarding.
- Tax capabilities remain exactly as defined by `global-tax-capabilities.js`: India legacy GST; UK standard-rated VAT baseline; UAE/Australia/Singapore standard-rate calculation baseline with issuance disabled; US/Canada require verified jurisdiction rules and remain disabled for issuance.
- Cashfree foreign-currency activation is independent of workspace country selection. Country choice does not enable checkout in a currency that the payment provider has not activated.
- Global usage reports, payment-log screen, service catalog, quick templates, shared-link management and team-management UI remain unavailable rather than displaying India-only or disconnected data.
- This is a code/test release candidate only. No live Supabase schema/data mutation or Cloudflare production deployment is part of this branch. Merge/deploy only after the latest branch checks pass and the product owner accepts the explicit limitations above.
