# Plivex Global Tax Engine — Research & Implementation Specification

Status: RESEARCH BASELINE — NOT PRODUCTION TAX ADVICE
Prepared: 2026-11-14
Target: `global-dev` only
Initial inspected branch HEAD: `01400f90d786c6bc4c3d86bada7b092a867a55fa`

## 1. Purpose and safety boundary

Build a country-aware indirect-tax calculation engine for the seven currently selectable Plivex countries: IN, US, GB, AE, CA, AU, SG.

This engine must calculate invoice tax only from explicit, validated business/tax profile data and versioned rules. It must not infer tax registration, nexus, place of supply, product tax classification, exemptions, or filing obligations from country selection alone.

A country selection is identity/locale metadata, not proof that a business is registered or liable to collect tax.

No production deployment, live Supabase migration, live tax filing, or live payment change is authorized by this specification.

## 2. Findings from existing repository

- `src/global/countries/country-registry.js` explicitly describes the registry as identity-only and says it does not imply tax calculation, legal invoice compliance, or FX conversion.
- `src/pages/TaxSummary.jsx` is currently India-specific: it displays CGST/SGST/IGST and exports GSTR-1 JSON.
- `src/lib/gstrExport.js` contains India GSTIN, place-of-supply, invoice and GSTR-1 export logic.
- `src/global/tests/india-regression.test.mjs` includes an India GST arithmetic oracle and source-contract checks.
- The existing India path must remain behaviorally unchanged until a separately reviewed integration plan is approved.

## 3. Country-by-country tax model

### India (IN)
- Existing GST implementation remains the compatibility baseline.
- Tax treatment depends on supply classification, HSN/SAC, registration status and place of supply; intra-state and inter-state treatment differs.
- Preserve CGST/SGST/UTGST/IGST and cess representation where applicable.
- Do not replace official HSN/SAC rate data with one generic country rate.
- Official references:
  - CBIC invoice rules: https://cbic-gst.gov.in/gst-invoice-rules.html
  - CBIC GST goods/services rate schedules: https://cbic-gst.gov.in/hindi/gst-goods-services-rates.html
  - GST Portal HSN/SAC lookup guidance: https://tutorial.gst.gov.in/userguide/taxpayersdashboard/Search_HSN_SAC_Tax_Rates.htm

### United States (US)
- Do not model the US as a single national VAT/GST rate.
- Sales/use tax may involve state, county, city and special district rates; taxability and seller collection obligations depend on jurisdiction, product/service and nexus.
- Require a validated destination jurisdiction and an explicit seller collection-obligation determination before automatic tax calculation.
- Initial release must support an adapter interface for a maintained jurisdiction/rate source; do not ship a guessed nationwide rate table or ZIP-only approximation.
- Example official state source demonstrating address-sensitive district rates and effective dates:
  - California CDTFA rates and address lookup: https://cdtfa.ca.gov/taxes-and-fees/sales-use-tax-rates.htm
  - California rate lookup: https://gis.cdtfa.ca.gov/

### United Kingdom (GB)
- Model standard, reduced, zero-rated and exempt treatments as distinct tax categories, not just numeric rates.
- Product/service classification and effective date determine treatment.
- Official reference: https://www.gov.uk/vat-rates

### United Arab Emirates (AE)
- Model standard-rated, zero-rated and exempt supplies separately, with registration status and effective date.
- FTA currently describes mandatory registration threshold AED 375,000 for resident businesses and voluntary threshold AED 187,500; non-resident rules differ. Do not make an eligibility decision from turnover alone without the relevant facts.
- Tax invoice and VAT return requirements are separate from calculation.
- Official references:
  - FTA VAT registration: https://www.tax.gov.ae/en/services/vat.registration.aspx
  - FTA VAT returns: https://tax.gov.ae/en/content/filing.vat.returns.and.making.payments.aspx

### Canada (CA)
- Model GST/HST and applicable provincial tax components separately.
- Rate depends on place of supply and supply type; zero-rated and exempt are distinct.
- Require province/territory and relevant destination/place-of-supply evidence. Do not use one CAD-wide rate.
- Official reference: https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-place-supply.html

### Australia (AU)
- Model GST, GST-free and input-taxed treatments separately.
- ATO describes GST as 10% on most taxable supplies; registration threshold and exceptions apply. The engine must not assume every business is registered.
- Tax invoice and BAS reporting are separate capabilities.
- Official references:
  - ATO GST accounting: https://www.ato.gov.au/Business/GST/Accounting-for-GST-in-your-business/
  - ATO GST overview: https://www.ato.gov.au/api/public/content/0-28262f91-6835-40bb-a9fe-99ee7d0b7c72

### Singapore (SG)
- Model standard-rated, zero-rated and exempt supplies separately.
- Current standard GST rate is 9%; only GST-registered businesses charge/claim GST from their effective registration date.
- Tax invoice fields and foreign-currency conversion rules need separate handling; no FX conversion may be invented.
- Official references:
  - IRAS current GST rate: https://www.iras.gov.sg/taxes/goods-services-tax-%28gst%29/basics-of-gst/current-gst-rates
  - IRAS tax invoice requirements: https://www.iras.gov.sg/taxes/goods-services-tax-%28gst%29/basics-of-gst/invoicing-price-display-and-record-keeping/invoicing-customers
  - IRAS who can charge GST: https://www.iras.gov.sg/taxes/goods-services-tax-%28gst%29/basics-of-gst/goods-and-services-tax-%28gst%29-what-it-is-and-how-it-works

## 4. Required engine architecture

Separate the engine into these layers:

1. **Tax identity/profile** — seller country, registered status, registration number/type, effective-from date, registered jurisdictions, tax accounting basis and verified profile provenance.
2. **Transaction facts** — invoice date, goods/services, product tax category/HSN/SAC where applicable, buyer type, ship-from, ship-to, service location, price mode (inclusive/exclusive), discounts and currency.
3. **Jurisdiction resolver** — country-specific place-of-supply and jurisdiction resolution. US and Canada must use a reliable maintained jurisdiction/address service; unresolved cases fail closed.
4. **Rules provider** — versioned rules with authority/source URL, published/effective dates, jurisdiction, tax type, category, rate, treatment and expiry/supersession metadata.
5. **Pure calculator** — deterministic, side-effect-free arithmetic with explicit rounding policy and componentized tax results.
6. **Invoice snapshot** — persist applied rule IDs, source/version, calculation inputs, tax components and calculation timestamp so later rate changes do not rewrite old invoices.
7. **Reporting adapter** — country-specific summaries only. Do not label a report as a government return or submit it unless a separately authorized, validated filing integration exists.

## 5. Required fail-closed behavior

Return a clear `needs_review` / non-calculable result instead of guessing when any required fact is missing, including:
- seller tax registration/effective date;
- destination or place of supply;
- product/service tax category;
- US nexus/collection obligation or valid jurisdiction;
- Canadian province/place of supply;
- tax rule missing, stale, expired or conflicting;
- exemption/zero-rate evidence missing;
- currency precision or rounding policy unknown.

Never silently default an unknown tax rate to 0%, 5%, 10%, 18%, or the seller's home country rate.

## 6. Calculation and data integrity requirements

- Use exact decimal or integer-minor-unit arithmetic; do not use binary floating-point as the authoritative financial representation.
- Support multiple tax components on one supply (e.g. GST/HST/PST, CGST/SGST/IGST, state/local/district sales tax).
- Support inclusive and exclusive pricing, line-level discounts, tax-on-tax only where the source rule explicitly requires it, credit notes and reversals.
- Store currency code and precision independently from locale.
- Use an explicit, tested rounding policy per jurisdiction and document line-level vs invoice-level rounding.
- Snapshot rule version and tax calculation on finalized invoices; never recalculate old invoices silently.
- Reject invalid rates, negative taxable bases (except explicit credit-note paths), duplicate component IDs and inconsistent totals.

## 7. Required tests before feature approval

- Unit tests for each treatment: standard, reduced, zero-rated, exempt, out-of-scope and reverse-charge where applicable.
- Inclusive/exclusive price arithmetic and rounding boundaries.
- Multiple tax components and mixed-rate invoices.
- Discounts, credit notes, refunds and invoice edits.
- Effective-date boundary tests (day before/on/after rate change).
- Missing/invalid registration and jurisdiction fail-closed tests.
- Cross-workspace authorization and RLS tests for any persisted tax profiles/rules.
- India regression: existing CGST/SGST/IGST, GSTIN, GSTR-1 and invoice RPC contract unchanged.
- Browser/mobile tests and disposable PostgreSQL integration tests.
- No test may call live tax authority filing endpoints.

## 8. Delivery phases within the Tax Engine workstream

A. Research and schema contract (this document).
B. Pure calculator and country-neutral tax result contract.
C. Country adapters and validated initial rule coverage.
D. Invoice integration and immutable tax snapshots.
E. Tax summary/report UI and country-specific invoice presentation.
F. Integration, security, regression and audit.

The seven countries may be selectable in the product, but automatic tax calculation must remain disabled for any jurisdiction/category/rule coverage that has not passed official-source verification and tests. The feature must clearly disclose partial coverage rather than imply complete country-wide compliance.

## 9. Explicit non-goals for initial delivery

- Legal/tax advice or determining whether a business must register.
- Automatic tax registration.
- Filing or paying government returns.
- US nationwide address-level rate/taxability coverage without a maintained authoritative data provider.
- Automatic FX conversion without a separately approved rate source.
- Claiming that Plivex guarantees legal compliance.

## 10. Source freshness and maintenance

Each rule must retain the official authority URL, source title, source retrieval date, effective-from/to dates, last-reviewed date and reviewer. A scheduled/manual review process must detect changed official pages and mark affected rules stale until revalidated. The ruleset must be versioned and auditable.

This document is an engineering specification and research record, not a statement that the Tax Engine has been implemented or that Plivex is legally compliant in these jurisdictions.
