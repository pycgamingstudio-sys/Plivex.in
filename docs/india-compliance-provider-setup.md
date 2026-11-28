# India compliance provider setup (Stage 1)

## Current implementation boundary

Plivex now contains workspace-scoped records and a Main Workspace workbench for:
- TDS deduction records, server-calculated in integer paise, with financial-year/quarter tagging and challan/status tracking.
- IRN e-invoice payload preparation with seller/buyer GSTIN checks and per-line HSN/SAC + UQC validation.
- E-way bill payload preparation with GSTIN, dispatch/delivery address and transport-detail validation.
- Provider setup metadata that stores only a Supabase secret-name reference. No credential values are stored in PostgreSQL or browser code.

This is **not** a live GSTN/IRP connection. No IRN is generated, no e-way bill is generated, and no GST/TDS return is filed by these workflows. Records remain in draft/ready/manual states until a real provider adapter is connected and verified.

## What the workspace owner must provide

1. Choose an eligible GST Suvidha Provider (GSP) / Invoice Registration Portal (IRP) provider that offers API access for e-invoice and e-way bill in the required environment.
2. Obtain the provider's sandbox documentation, API base URL, authentication method, client/account identifier, test credentials and webhook/signature requirements.
3. Confirm the provider's production onboarding requirements and pricing before enabling any paid plan. Plivex will not purchase or activate a paid provider.
4. Create the required Supabase Edge Function secrets in the project's server-side secrets manager. Use provider-specific names such as `PLIVEX_GST_IRP_SECRET`; do not place secret values in the app, GitHub, SQL migrations, or chat.
5. In the Plivex compliance workbench, save the provider name, environment and matching secret-name reference. This only records setup metadata; it does not mark the provider as verified.
6. Supply the provider's documented sandbox contract and test account access through the approved secure setup process. The adapter can then be implemented and sandbox-tested.
7. Only after sandbox tests pass, request explicit authorization before enabling production credentials or production submissions.

## Tests required before a provider can be marked verified

- Authentication, token refresh and secret rotation.
- GSTIN/IRN request schema and all mandatory invoice fields.
- Duplicate/idempotent requests and provider timeout/retry behaviour.
- Provider response signature verification and webhook replay protection.
- IRN, acknowledgement number/date, signed invoice and signed QR persistence.
- E-way bill generation, validity, cancellation and extension flows.
- Rate limiting, audit trail, workspace isolation and failure recovery.
- Sandbox evidence for each supported document type.

## TDS boundary

The current TDS module records manually selected section/rate inputs and calculates the amount using integer minor units. It does not determine statutory applicability/rates, create Form 26Q/24Q/27Q filings, deposit challans, or connect to TRACES/OLTAS. Those require separately validated tax logic and authorized filing access.

## Security rule

Only secret *names/references* may be saved in Plivex configuration. Secret values must remain in Supabase Edge Function Secrets. Never expose service-role keys or provider credentials to the frontend.
