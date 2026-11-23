# Main Workspace platform capabilities

These capabilities are implemented against the canonical `public.workspace_settings.workspace_id`. They do not create or depend on a separate Global Workspace.

## Electronic signature audit

- Create or revoke a one-time link for an issued Main Workspace invoice.
- Store only the SHA-256 token hash; links expire after 1–30 days and can be completed once.
- Record signer consent, timestamp, hashed IP, user agent, document snapshot hash and a workspace audit event in one database transaction.
- Pending requests can be revoked by a Workspace administrator/manager; revocation is audited.
- This is an electronic-signature audit record, not a qualified eIDAS signature, Aadhaar eSign, DSC or government-certified signing service.

## Document OCR

- Upload up to 10 JPEG, PNG, WebP or PDF documents (4 MB each) per UI batch to private Storage.
- Gemini extracts structured draft values. Human review is required; no accounting or tax record is posted automatically.
- Configure `GEMINI_API_KEY`; optional model override: `GEMINI_OCR_MODEL` (default `gemini-3.8-flash`).

## WhatsApp Cloud

Configure Supabase Edge Function secrets:
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_APP_SECRET`
- `WHATSAPP_VERIFY_TOKEN`
- Optional `WHATSAPP_GRAPH_VERSION` (default `v22.0`)

Webhook URL:
`https://sqzpaiibmfsvarrkwkvb.supabase.co/functions/v1/workspace-whatsapp-webhook`

Subscribe the Meta app to the WhatsApp `messages` webhook field. The handler verifies `X-Hub-Signature-256`. Free-form text requires a customer-initiated conversation within the 24-hour window; otherwise use an approved template. The operator must record the customer's opt-in evidence before sending. Meta acceptance is not final delivery.

## Public API and MCP

- Create scoped, hashed, expiring and revocable keys from Workspace → More → Platform integrations.
- Requests are limited to 60 per key per rolling fixed window; rate-limit counters are stored separately from API key secrets.
- The secret is displayed once only. Store it on a trusted server, never in browser code.
- Send the Supabase publishable/anon key as `apikey` and the Plivex key as `x-plivex-key` to:
  `https://sqzpaiibmfsvarrkwkvb.supabase.co/functions/v1/workspace-platform`
- REST actions: `workspace.summary`, `invoices.list`, `clients.list`, `expenses.list`, `leads.list`, `inventory.low_stock`.
- MCP JSON-RPC methods: `initialize`, `notifications/initialized`, `tools/list`, `tools/call`.
- MCP tools are scope-limited. Business insights use aggregate metrics only; customer PII is not sent to Gemini.

## Inventory serial traceability\n\n- Main Workspace can register unique serial numbers per stock item and warehouse, record batch references, move serials between active warehouses, and track reserved/sold/returned/defective transitions.\n- Sales transitions require an issued invoice reference. Every lifecycle action is recorded in a serial event log. This traceability ledger does not silently change aggregate stock quantities.\n\n## Supplier onboarding\n\n- Admins/managers can invite suppliers by email (Brevo first, Resend fallback) or copy a secure link if mail is not configured. Links are hashed, single-use and expire after seven days.\n- Supplier details are submitted atomically with the token consumption, validated against the Main Workspace country, and routed for admin/manager review.\n\n## Sales document workflows\n\n- Main Workspace supports idempotent sales orders with item-level tax, delivery challans with quantity ceilings and dispatch/receipt lifecycle, and credit/debit note drafts.\n- Credit note issuance is capped against the remaining issued invoice total. Document lifecycle events are audited; creating or issuing these documents does not silently post accounting journals or submit government filings.\n\n## Recurring invoices\n\n- Admins/managers can schedule daily, weekly, monthly or yearly draft generation from an issued invoice. Generated drafts copy the source tax snapshot and line items, receive a new invoice number and are never auto-issued or auto-sent.\n- Schedules are idempotent by occurrence date and can be paused, resumed or cancelled. A country/currency change automatically pauses the schedule to prevent cross-country tax snapshot reuse.\n\n## Approvals and permissions\n\n- Main Workspace supports five sequential approval steps, self-approval blocking, per-currency minimum thresholds and a five-minute overdue escalation job. Requests and decisions are audited.\n- Admins/managers can delegate selected permissions to an active workspace member for up to 90 days, revoke delegations and set role/member overrides.\n- Approval policy and permission RPCs validate the authenticated user against the same public Main Workspace ID.\n\n## Deployment status and limitations

The Main Workspace database migration and Edge Functions are deployed. Provider-backed WhatsApp delivery still requires the owner's Meta credentials and a real test message/webhook. OCR requires a valid Gemini key/model and a real sample-document test. Do not treat this feature as production-certified until those provider smoke tests pass.
