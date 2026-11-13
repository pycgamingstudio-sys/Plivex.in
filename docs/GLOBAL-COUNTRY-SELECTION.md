# Plivex Global — Country Selection System (Part 2)

**Status:** Isolated country identity and selection foundation. Not production-connected.  
**Branch:** `global-dev`  
**India production:** `main` remains unchanged.

## Scope

Part 2 adds a country registry and an explicit, validated selection/persistence contract. It does not add a visible onboarding screen or connect the feature to authentication, workspaces, Supabase, invoices, tax calculations, payments, or production UI.

## Initial selectable country identities

| ISO 3166-1 alpha-2 | Country | ISO 4217 currency | Locale choices |
| --- | --- | --- | --- |
| IN | India | INR | en-IN, hi-IN |
| US | United States | USD | en-US, es-US |
| GB | United Kingdom | GBP | en-GB |
| AE | United Arab Emirates | AED | en-AE, ar-AE |
| CA | Canada | CAD | en-CA, fr-CA |
| AU | Australia | AUD | en-AU |
| SG | Singapore | SGD | en-SG, zh-SG, ms-SG, ta-SG |

These are selectable business-country identities only. Every entry is marked `identity-only`; none of these entries asserts that Plivex tax, invoice, payment, or legal requirements are implemented for that country.

## Contracts and safeguards

- Country identifiers are ISO 3166-1 alpha-2 codes; currency identifiers are ISO 4217 codes.
- Currency and locale are separate attributes. Selecting a country does not choose a language.
- Unknown, malformed, or unsupported country codes are rejected. Country selection does not silently default to India or infer a country from IP, device locale, or currency.
- No selection is persisted until the caller supplies explicit confirmation.
- Persisted data is versioned and revalidated on every read. Corrupt, unsupported, or outdated records are ignored.
- Storage is injected for tests and SSR safety. Browser storage access is guarded against unavailable or blocked storage.
- The registry is isolated under `src/global` and is not imported into the existing India application.
- The selection record is a user-interface preference only; it is not authorization, legal residence, tax jurisdiction proof, or a substitute for server-side workspace validation.

## Public module API

- `COUNTRY_REGISTRY`, `getCountryByCode(code)`, `listSelectableCountries()`
- `validateCountrySelection(countryCode)`
- `createCountrySelectionStore(storage)` with `read()`, `save({ countryCode, confirmed: true })`, and `clear()`
- `createBrowserCountrySelectionStore()` for guarded browser/SSR usage

## Deliberate non-goals

- No tax rates, tax engine, VAT/GST treatment, invoice legal fields, payment rails, or country compliance claims.
- No UI integration or database migration.
- No automatic country detection.
- No change to India production or deployment.

A later UI/onboarding part must show the country name and currency clearly, require a deliberate confirmation, allow changing the choice, and save the choice against the authenticated workspace server-side after authorization. Browser local storage alone must never be treated as the authoritative workspace country.
