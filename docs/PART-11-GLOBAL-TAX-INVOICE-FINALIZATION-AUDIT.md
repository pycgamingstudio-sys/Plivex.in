# Part 11 — Global Tax Invoice Finalization & E-Invoice Readiness

Status: implementation boundary and release audit; not a tax-compliance certification.

## Delivered in this part

- Adds a finalization boundary that freezes a tax result only when it is a successful, country-matched calculation with a versioned, source-backed rule effective on the invoice date.
- Rejects manual/unverified estimates, missing provenance, invalid dates, inconsistent totals and component mismatches from immutable tax snapshot creation.
- Freezes nested snapshot data so later UI edits cannot mutate the captured in-memory tax record. The existing issued-invoice database snapshot remains the durable historical record.
- Adds explicit e-invoice readiness metadata for all seven selectable countries.
- Provides a guarded submission-preparation adapter that always refuses transmission until the required government-network/access-point/accredited-provider integration is configured. It does not fake an IRN, acknowledgement, network delivery or filing.
- Leaves India on the existing GST path. No India GST code, GSTR-1 export, or production invoice data is rewritten.
- Adds unit tests for all seven countries, snapshot provenance, effective dates, immutable values, reconciliation and provider-not-configured behavior.

## Country readiness boundaries (reviewed 15 November 2026)

| Country | Tax/invoice boundary | E-invoice boundary |
|---|---|---|
| India | Existing GST implementation remains authoritative within Plivex; this Global module does not replace it | Existing India GST/e-invoice workflow remains separate |
| United States | No nationwide sales-tax rate; state/local sourcing, nexus and product taxability remain provider/review dependent | No Plivex transmission adapter |
| United Kingdom | Existing narrow standard-rated VAT baseline only; other treatments remain unsupported | HMRC roadmap says VAT e-invoicing requirement begins 1 April 2029; no Peppol transmission enabled |
| UAE | Narrow standard VAT baseline only; designated zones, zero-rating, exemptions and reverse charge require further rules | Structured e-invoicing is phased and requires the UAE framework/provider; none configured |
| Canada | Province-level general components are informational; place-of-supply and product rules remain review-gated | No Plivex transmission adapter |
| Australia | Narrow standard GST baseline only; GST-free/input-taxed and special treatments remain unsupported | Peppol ecosystem exists; Plivex has no access-point integration |
| Singapore | Narrow standard GST baseline only; zero-rated/exempt/reverse-charge categories remain unsupported | InvoiceNow / IRAS submission is phased; no InvoiceNow-ready access point configured |

## Important limitation

This does **not** make all seven countries fully tax compliant, nor does it activate new invoice issuance in countries where the backend capability matrix is disabled. US/Canada rates are not guessed. User-entered registration details and manual rates are not represented as independently verified. E-invoice transmission is disabled for every country in this module until a provider contract, credentials, accreditation/onboarding and country-specific conformance tests exist.

No production database migration is required by this code-only part. Existing issued invoice records and historical tax snapshots are not recalculated.

## Official sources

- UK HMRC e-invoicing requirements, published 28 October 2026: https://www.gov.uk/government/publications/vat-electronic-invoicing/e-invoicing-requirements
- UAE Ministry of Finance e-invoicing portal and accredited-provider material: https://mof.gov.ae/en/about-us/initiatives/einvoicing/
- UAE Federal Tax Authority e-invoicing overview: https://www.tax.gov.ae/en/taxes/Vat/uae.einvoicing.aspx
- Singapore IRAS GST InvoiceNow phased requirement: https://www.iras.gov.sg/taxes/goods-services-tax-%28gst%29/gst-invoicenow-requirement
- Australian Taxation Office eInvoicing: https://www.ato.gov.au/businesses-and-organisations/preparing-lodging-and-paying/einvoicing
- Canada Revenue Agency place-of-supply and rates: https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate.html
- US California CDTFA local-rate schedule (example of address-specific variation, not a national US rule): https://cdtfa.ca.gov/taxes-and-fees/TaxRatesbyCountyandCity.pdf
- India GST e-invoice portal: https://einvoice.gst.gov.in/

This is an engineering release audit, not legal or tax advice. Country-specific professional review remains necessary before enabling broader automatic calculations, issuance or filing.
