# Part 10 — Jurisdiction, Registration and Product Tax Classification

## Delivered

- A country-aware jurisdiction catalogue for the seven supported countries.
- US state and District of Columbia identifiers (51 entries), intentionally without a guessed state or local rate.
- Canadian province/territory identifiers (13 entries) with the CRA-published general GST/HST/PST/QST component rates and a source reference.
- Administrative region identifiers for India, UK, UAE, Australia and Singapore; they do not imply a tax rate.
- Registration policy profiles for all seven countries.
- Source-backed screening thresholds where the official source is explicit:
  - UK VAT: GBP 90,000 taxable turnover.
  - UAE VAT: AED 375,000 mandatory and AED 187,500 voluntary threshold.
  - Australia GST: AUD 75,000; AUD 150,000 for non-profit organisations.
  - Singapore GST: SGD 1,000,000 retrospective/prospective taxable turnover tests.
- India, US and Canada deliberately do not receive a simplistic national threshold. Compulsory cases, nexus, non-resident rules, small-supplier rules and provincial registration remain review-gated.
- Country-specific product/service tax treatment vocabularies and required classification fields.
- Explicit business review required before classification is accepted. Product names, SKU, AI output or HSN/SAC do not automatically determine taxability.
- Unknown treatment always fails closed. Recorded classifications do not enable tax calculation without a separate active, source-backed jurisdiction rule.

## Important legal/technical boundaries

- US: state/local sales tax is highly jurisdictional. This part stores state identifiers only; county/city rates, sourcing, product taxability, economic/physical nexus and registration thresholds are not implemented as active rates. Streamlined Sales Tax taxability matrix is a source-discovery aid, not blanket legal authority.
- Canada: published general rates are reference components only. Place-of-supply, special supplies, provincial tax bases, registration and exemptions still require explicit rule selection and validation.
- UK: standard/reduced/zero/exempt/reverse-charge are represented, but product categories are not populated as legally complete classifications.
- UAE: designated zones, exports, reverse charge and exemptions require specialist rules.
- Australia: taxable/GST-free/input-taxed categories are represented, not a complete item-level classification catalogue.
- Singapore: standard/zero-rated/exempt/out-of-scope/reverse-charge categories are represented, not a complete item-level catalogue.
- India: existing GST remains on the established India path; HSN/SAC and GST treatment require the existing GST rules and official notifications.
- Registration threshold screening is not a legal determination and does not verify a business's tax number.
- No tax registration number is independently validated in this part.
- No new invoice issuance capability is enabled by this part.
- No production database migration, customer data update or Cloudflare deployment is included.

## Official source references

- India CBIC GST Act and GST rate schedules: https://cbic-gst.gov.in/CGST-bill-e.html and https://cbic-gst.gov.in/hindi/gst-goods-services-rates.html
- US Streamlined Sales Tax: https://www.streamlinedsalestax.org/
- UK HMRC VAT registration and rates: https://www.gov.uk/register-for-vat and https://www.gov.uk/vat-rates
- UAE Federal Tax Authority VAT registration: https://www.tax.gov.ae/en/taxes/Vat/vat.topics/registration.for.vat.aspx
- Canada Revenue Agency GST/HST rates and place of supply: https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate.html
- Australia ATO GST registration: https://www.ato.gov.au/business/gst/registering-for-gst/
- Singapore IRAS GST registration and treatment: https://www.iras.gov.sg/taxes/goods-services-tax-%28gst%29/gst-registration-deregistration/do-i-need-to-register-for-gst and https://www.iras.gov.sg/taxes/goods-services-tax-%28gst%29/basics-of-gst/goods-and-services-tax-%28gst%29-what-it-is-and-how-it-works

All threshold/rate data must be re-reviewed against the official authority before production activation. This part is a software rules framework, not tax advice or a compliance certification.
