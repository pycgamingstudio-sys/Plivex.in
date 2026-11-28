# Plivex Public API v1

## Endpoint and authentication

Send JSON POST requests to:

`{SUPABASE_URL}/functions/v1/workspace-platform`

Required headers:

- `apikey: {SUPABASE_PUBLISHABLE_KEY}`
- `x-plivex-key: {PLIVEX_API_KEY}`
- `x-plivex-api-version: v1`
- `content-type: application/json`

API keys are created by a Main Workspace administrator or manager. Only a SHA-256 hash is stored; the raw key is displayed once. The key determines the workspace. The API does not accept a client-supplied workspace ID.

The current per-key rate limit is **60 requests per 60 seconds**. A rate-limited request returns HTTP 429 and a retryable structured error.

## Scopes

| Scope | Capability |
|---|---|
| `workspace.read` | Read workspace country, base currency and aggregate counts |
| `invoices.read` | List workspace invoices |
| `clients.read` | List workspace clients |
| `expenses.read` | List workspace expenses |
| `leads.read` | List CRM leads |
| `leads.write` | Create CRM leads with idempotency protection |
| `inventory.read` | List low-stock inventory items |
| `suppliers.read` | Reserved for the supplier read adapter; not exposed as a route until its response contract is verified |
| `mcp.read` | Use the existing read-only MCP tool surface; requires `workspace.read` |

The API supports up to nine distinct scopes per key. Grant only the scopes required by the consuming system. Revoke a key immediately if it is no longer needed. For rotation, create a replacement key, update the server-side consumer, verify it, then revoke the old key.

## Read request and pagination

Example:

```http
POST /functions/v1/workspace-platform
apikey: <publishable-key>
x-plivex-key: <plivex-api-key>
x-plivex-api-version: v1
content-type: application/json

{
  "apiVersion": "v1",
  "action": "invoices.list",
  "limit": 50
}
```

Read actions:

- `workspace.summary`
- `invoices.list`
- `clients.list`
- `expenses.list`
- `leads.list`
- `inventory.low_stock`

List responses include:

```json
{
  "ok": true,
  "api_version": "v1",
  "records": [],
  "pagination": {
    "limit": 50,
    "has_more": false,
    "next_cursor": null
  }
}
```

The maximum page size is 100. When `has_more` is true, pass `next_cursor` as the `cursor` value in the next request. Cursors are opaque, validated and ordered by `created_at` then `id` descending. Do not construct or modify cursors.

## Idempotent CRM lead creation

Only the CRM lead create operation is currently exposed as a write. Invoice, payment, accounting, inventory and supplier writes are intentionally not available through this public API.

Required scope: `leads.write`.

```http
POST /functions/v1/workspace-platform
apikey: <publishable-key>
x-plivex-key: <plivex-api-key>
x-plivex-api-version: v1
Idempotency-Key: crm-import-2026-11-28-0001
content-type: application/json

{
  "apiVersion": "v1",
  "action": "leads.create",
  "name": "Acme Trading",
  "company": "Acme Trading",
  "email": "accounts@example.com",
  "phone": "+12025550123",
  "requirement": "Wholesale enquiry",
  "value": 1250.00
}
```

The idempotency key must be 8–128 characters using letters, digits, period, underscore, colon or hyphen. The same key and same normalized request return the original result. Reusing a key with a different request returns HTTP 409. Idempotency records are retained for seven days and cleaned up by a scheduled database job.

The server validates the payload, derives the workspace and base currency from the API key, assigns the lead owner from the key creator, and writes the lead and idempotency result in one database transaction. A correlation ID is generated when the caller does not provide a valid UUID in `x-correlation-id`.

## Structured errors

Errors use this stable envelope:

```json
{
  "api_version": "v1",
  "error": {
    "code": "API_RATE_LIMITED",
    "message": "The API rate limit has been reached.",
    "retryable": true,
    "request_id": "123e4567-e89b-42d3-a456-426614174000"
  }
}
```

Common codes include `API_KEY_REQUIRED`, `API_KEY_INVALID`, `API_SCOPE_DENIED`, `API_RATE_LIMITED`, `API_VERSION_UNSUPPORTED`, `API_CURSOR_INVALID`, `API_LIMIT_INVALID`, `API_IDEMPOTENCY_KEY_REQUIRED`, `API_IDEMPOTENCY_KEY_INVALID`, `IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_IN_PROGRESS`, `API_READ_FAILED` and `API_WRITE_FAILED`.

## Security and limitations

- Keep API keys on trusted servers. Never put them in frontend bundles, public URLs, source control or logs.
- The key hash, scope check, expiry, revocation and rate limit are checked server-side.
- Workspace isolation is derived from the stored API key, not request JSON.
- Read pagination is bounded and stable; no unbounded list response is returned.
- Only CRM lead creation is currently write-enabled. Other resources require a separately reviewed contract, scope and idempotency implementation.
- The existing MCP business-insights tool remains an existing optional feature; this Stage 3 work does not add AI functionality.
