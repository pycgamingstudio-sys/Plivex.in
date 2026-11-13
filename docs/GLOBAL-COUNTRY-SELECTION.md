# Plivex Global — Part 2: Workspace Country Selection

**Implementation branch:** `global-dev`  
**India production:** `main` is unchanged.  
**Capability status:** country identity and regional display formatting only.

## Delivered scope

- Seven selectable business-country identities: India (INR), United States (USD), United Kingdom (GBP), UAE (AED), Canada (CAD), Australia (AUD), and Singapore (SGD).
- A country and matching locale selector is available on the authenticated Business Profile page.
- Selection is saved only after the user presses **Confirm and save country**.
- The authoritative choice is stored in the workspace's existing `business_profile` record, not browser local storage.
- The existing `workspace-records` Edge Function derives the workspace from the authenticated user's `profiles.workspace_id`; clients cannot submit a workspace ID to choose the target.
- The Edge Function validates the country/locale pair, and the database constraint independently rejects unsupported pairs.
- The selector loads the saved choice from the server and displays a locale-aware currency/number preview. Formatting does not convert amounts.
- Existing India invoice, GST, inventory, quotation and payment behavior is not switched by country selection.

## Persistence

Migration: `202611130006_workspace_country_identity.sql`

Adds nullable `country_code` and `locale_code` columns to `public.business_profile`. Existing rows remain unset until explicit confirmation. A check constraint permits only the supported country/locale combinations. No RLS policy or table grant is broadened; the existing authenticated workspace-records path and table policies remain the access boundary.

## Safety boundaries

- No IP/device-locale country detection and no silent India fallback.
- No automatic save, country conversion, exchange-rate lookup, tax calculation, VAT/GST engine, legal invoice claims, or payment-rail enablement.
- Country identity is not proof of legal residence or tax jurisdiction.
- Existing India workflows remain the default behavior; this feature is an opt-in workspace setting.
- No live Supabase migration, production deployment, or `main` change was performed.

## Verification still required

Chat 2 must run the full build, lint, typecheck, `npm run test:global`, PostgreSQL migration integration and India regression checks. It must verify the migration against the CI PostgreSQL schema, exercise authenticated workspace isolation and RLS, test invalid country/locale writes, and report actual workflow run IDs and logs. A live Supabase rollout remains a separately authorized operation.
