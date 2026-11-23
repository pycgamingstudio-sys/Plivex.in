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

## Deployment status and limitations

The Main Workspace database migration and Edge Functions are deployed. Provider-backed WhatsApp delivery still requires the owner's Meta credentials and a real test message/webhook. OCR requires a valid Gemini key/model and a real sample-document test. Do not treat this feature as production-certified until those provider smoke tests pass.
