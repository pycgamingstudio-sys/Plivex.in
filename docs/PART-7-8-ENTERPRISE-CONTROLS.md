# Part 7 — Global tax, currency and country foundations

This is an isolated implementation candidate based on `global-dev`. It does not deploy migrations or change production.

## Implemented in this candidate
- Allow-listed currency minor-unit precision with own-property checks; integer/rational FX conversion and exact locale-aware formatting.
- Versioned tax-rule validation with country/currency pairing, official-source host restrictions, exact jurisdiction resolution, effective dates and duplicate/overlap protection at publication.
- Server-only tax-rule publication gate and append-only tax-calculation audit storage in an additive candidate migration.
- Integer-only tax calculation arithmetic with overflow rejection; explicit seller registration/effective-date and US/Canada jurisdiction/collection-obligation gates.
- Country invoice checklists for GB, AE, AU and SG; US/Canada return jurisdiction-review-required rather than generic invoice assumptions.
- Capability matrix clearly distinguishes legacy India handling, limited country checklists and unsupported tax treatments.

## Country readiness
- India: existing GST implementation only; this branch does not replace or modify it.
- GB, AE, AU, SG: standard-rate-only foundations and invoice checklists; reduced/zero/exempt/special treatments require separately maintained verified rules and review.
- US, CA: no national rate assumption; exact state/local or provincial jurisdiction and seller collection-obligation evidence are mandatory.
- AE: foreign-currency tax invoice calculation and UAE-specific line rounding are not implemented; the checklist is AED-only.
- FX: only explicit, source-attributed rational snapshots are accepted; no exchange-rate provider is invented or fetched automatically.

## Explicit limitations
- This is not a tax-compliance certification. Business confirmations are recorded as attestations, not independent legal verification.
- The country invoice validators are checklists, not a substitute for local professional review.
- The new migration is a candidate only. No live Supabase migration, production deployment, tax-rule publication or real invoice finalization has been performed.
- End-to-end invoice/business-record integration, production tax-rate maintenance operations, country-by-country independent legal review and final security review remain separate release gates.
