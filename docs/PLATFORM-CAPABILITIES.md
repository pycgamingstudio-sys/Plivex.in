# Plivex Global Platform Capabilities

This release candidate adds four workspace platform capabilities on top of the existing enterprise delegation controls.

## 1. Electronic signature audit

- Create a one-time invoice signing link for a named signer.
- The token is stored as SHA-256 only, expires after 1–30 days (14 by default), and can be completed once.
- The signer sees invoice number, dates, amount, currency and the document snapshot hash before confirming consent.
- The completion RPC locks the request row, validates the expiry and signer name, writes the signature record and audit event in one database transaction.
- The audit stores a document snapshot hash, signature name, consent text, timestamp, hashed IP and user agent.
- This is an electronic-signature audit trail. It is not a qualified eIDAS signature, Aadhaar eSign, DSC, or government-certified signing service.

## 2. Document OCR

- Upload JPEG, PNG, WebP or PDF up to 8 MB to a private Storage bucket.
- Gemini extracts a structured draft for invoices, receipts and purchase orders.
- The original file is kept in private storage and the extraction is stored as an OCR job.
- No invoice, expense, inventory or accounting record is created automatically. A human must review and confirm extracted values.
- Configure `GEMINI_API_KEY`; optional model override: `GEMINI_OCR_MODEL` (default `gemini-2.5-flash`).

## 3. WhatsApp Cloud

Configure these Supabase Edge Function secrets:
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_APP_SECRET`
- `WHATSAPP_VERIFY_TOKEN`
- Optional: `WHATSAPP_GRAPH_VERSION` (default `v22.0`)

Webhook callback URL:
`https://sqzpaiibmfsvarrkwkvb.supabase.co/functions/v1/whatsapp-webhook`

Subscribe the Meta app to the WhatsApp `messages` webhook field. The handler verifies Meta's HMAC signature and updates accepted/sent/delivered/read/failed states. Free-form text is permitted only when the customer-initiated 24-hour window is supplied; otherwise an approved template is required. The operator must record evidence of the customer's opt-in before sending. Meta acceptance is not the same as final delivery.

## 4. Public API and MCP

- Create scoped keys in the Global workspace Integrations & AI section. Keys expire in at most 365 days and can be revoked.
- Only SHA-256 key hashes are stored; the secret is displayed once.
- Send the key in `x-plivex-key` to:
  `https://sqzpaiibmfsvarrkwkvb.supabase.co/functions/v1/global-platform`
- REST operations: `workspace.summary`, `invoices.list`, `clients.list`.
- MCP JSON-RPC methods: `tools/list`, `tools/call`.
- Tools: `workspace_summary`, `list_invoices`, `list_clients`, `business_insights`.
- Data tools are read-only. The AI insight tool uses aggregate invoice metrics only and requires `workspace.read` + `mcp.read` scopes.
- Keys are rate-limited and invalidated if the creating workspace administrator is no longer active.

## Deployment and verification

Required secrets must be set before enabling the corresponding provider actions. Apply the migration before deploying `global-platform` and `whatsapp-webhook`. Run the global regression suite and production smoke tests. Do not mark a provider as live until its credentials, webhook verification and a real test message have been confirmed.
