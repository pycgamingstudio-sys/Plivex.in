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
- `src/pages/Home.jsx`: Global invoice path is present, but India-oriented defaults and labels remain in shared page source and require runtime audit.
- `src/lib/i18n.js`: existing translation infrastructure requires coverage review.
- Global country, invoice, tax, India regression, workspace isolation and onboarding tests already exist under `src/global/tests`.

### Initial gaps to investigate and close

1. Trace selected signup country through auth provisioning into the persisted workspace; prove there is no silent India fallback.
2. Audit every routed page, shared component, PDF/document renderer, email/share template, AI prompt/function and backend Edge Function for India-only assumptions.
3. Centralize workspace context and country adapter selection; remove scattered country checks only where safe and covered by tests.
4. Complete locale catalogs and right-to-left behavior for Arabic, plus fallback rules that never change the workspace's country or currency.
5. Audit currency precision, date/time zone, decimal/group separators, phone/address/postal formats, units and invoice numbering independently.
6. Separate country tax capability from country selection and seller registration. Do not enable unverified US state/local or Canadian province/territory tax rules.
7. Audit payment providers, subscription display currency and checkout currency separately; provider activation is not implied by a country selector.
8. Add a seven-country UI/API/document test matrix and India regression gate.
9. Verify workspace isolation, RLS, server-side authorization and historical snapshot preservation.
10. Stage and smoke-test before any production rollout; no production schema/data mutation is part of this audit commit.

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
