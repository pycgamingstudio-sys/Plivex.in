# Part 6 — Worldwide tax capability foundation

## Safety contract

Country selection is not tax registration, taxability, place of supply, nexus, or legal compliance. Plivex must never infer a tax rate from country identity alone. Unknown or unconfigured countries remain draft-only and tax calculation/issuance must fail closed.

## Current capability matrix

| Country | Calculation capability | Invoice issuance |
|---|---|---|
| India (IN) | Existing India GST path only | Existing India flow |
| United Kingdom (GB) | Source-backed standard VAT baseline | Code adapter exists; production database migration still pending |
| UAE (AE) | Source-backed standard VAT baseline | Disabled |
| Australia (AU) | Source-backed standard GST baseline | Disabled |
| Singapore (SG) | Source-backed standard GST baseline | Disabled |
| United States (US) | Verified state/local rule required | Disabled |
| Canada (CA) | Verified province/territory rule required | Disabled |
| All other countries | Not configured; draft-only | Disabled |

## Rule requirements before a country can issue

1. Official government source, reviewed date, rule version and effective date.
2. Correct tax registration evidence and effective date.
3. Place-of-supply / destination evidence.
4. Product/service tax classification and treatment.
5. Local sub-jurisdiction rules where applicable.
6. Integer minor-unit calculation and rounding tests.
7. Immutable invoice tax snapshot and server-side issuance enforcement.
8. Country-specific integration, migration replay, regression and rollback tests.

## Rollout policy

Add countries incrementally behind explicit capability entries. Never enable a country merely because it is selectable in onboarding. Do not use user-entered rates as verified law. Do not modify India GST tables/RPCs while adding Global adapters.

This Part 6 foundation does not claim worldwide tax compliance or worldwide invoice issuance. It makes the supported/unsupported boundary explicit and testable so future jurisdiction packs can be added safely.
