# Part 9 — Universal Tax Engine & Versioned Rule Catalogue

Status: implementation candidate. This audit is not a claim of tax-law or invoice-compliance certification.

## Scope delivered

- Introduces a semantic tax-engine version and a separately versioned rule-catalogue version.
- Centralizes the seven selectable country tax-readiness profiles.
- Moves the four already-reviewed, country-level standard-rate baselines (GB, AE, AU, SG) into one immutable catalogue with rule ID, version, legal effective dates, review date, currency, treatment, scope, source authority and official source URL.
- Keeps India on its established GST path.
- Keeps US and Canada without a national default rate; they require a jurisdiction-specific rule.
- Adds date-aware rule resolution and defensive copies.
- Preserves the existing evaluator contract through a compatibility adapter.
- Adds regression tests for versioning, country coverage, effective dates, defensive copies and fail-closed behavior.

## Explicit non-goals

- This catalogue is source-controlled application metadata, not a live Supabase tax-rule table. No production database schema or customer data is changed in Part 9.
- It does not add reduced, zero-rated, exempt, reverse-charge, import/export, special-zone, product-level or exemption rules.
- It does not independently verify seller registration, nexus, collection obligations, place of supply or product tax classification.
- It does not enable invoice issuance or tax filing for countries whose existing capability matrix disables them.
- It does not claim full compliance for any country.

## Rule governance

Every future rule change must add a new immutable version rather than alter the meaning of an existing rule. Legal effective dates must remain distinct from the date the rule was reviewed. A rule must identify its jurisdiction scope, tax treatment, currency, official authority and source URL. Country selection alone is never evidence of registration or tax liability.

The four existing standard-rate records retain their previous review date (2026-11-14) and sources. They are intentionally labelled standard-rate-only. Part 10 must add jurisdiction and product-treatment coverage only after official-source research and professional validation.

## Release safety

- Unknown countries, invalid dates and out-of-period rules fail closed.
- India is not routed through the Global engine.
- US and Canada never receive an invented national rate.
- Historical issued invoices must continue to retain their saved rule snapshots.
- No live Supabase migration, Edge Function deployment or Cloudflare production change is included in this Part.
