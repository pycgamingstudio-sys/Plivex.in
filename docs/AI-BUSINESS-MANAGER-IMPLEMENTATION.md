# Plivex Intelligence — AI phase

## Operating contract
- Preserve existing Plivex features and workspace boundaries.
- Treat model output, user text, files, OCR and tool results as untrusted data.
- The model may propose allow-listed actions; only server validators and authenticated backend executors may write.
- A prepared draft is not a saved record. Report success only after the backend confirms and the result is verified.
- Ask one focused clarification when a required field or the intended business operation is genuinely ambiguous.
- Never claim a capability is live merely because its database table exists.

## Current verified write surface
The existing `execute_assistant_action_batch` RPC and `assistant-confirm` Edge Function currently support:
`create_client`, `create_expense`, `create_lead`, `create_stock`, `create_quotation`, `create_invoice`.
All six require the existing user confirmation flow. The RPC enforces workspace membership/roles, batch atomicity and idempotency.

## Module coverage and honest capability status
The registry catalogs clients, invoices, inventory, expenses, quotations, leads, services, suppliers, purchase orders, purchase receipts, warehouses, stock transfers, payments, staff, branches, analytics and automation.
Only modules with a verified read context or an implemented executor are marked available. Warehouse/procurement/payment/staff/branch/automation writes must not be invented by the model; they remain planned until each has a permission-checked server tool and end-to-end tests.

## Required execution pipeline
1. Parse the message and attachments; identify all intents and entities.
2. Retrieve only authorized workspace context, with bounded/paginated reads.
3. Build a dependency-aware plan; separate read-only questions from writes.
4. Validate every proposed tool call against strict schemas and business rules.
5. Detect duplicate/conflicting actions and preserve dependencies.
6. Present the complete action batch for user confirmation.
7. Execute through authenticated server-side allow-listed functions only.
8. Verify created/updated records and return exact per-action outcomes.
9. Record sanitized evaluation cases and run regression tests; never train on arbitrary customer data.

## Important distinctions the planner must test
- Create product vs receive stock for an existing product.
- Purchase order vs goods receipt vs stock adjustment.
- Create warehouse vs transfer stock into an existing warehouse.
- Incoming customer payment vs outgoing business expense.
- Payment evidence screenshot vs independently verified transaction.
- Draft invoice vs issued invoice vs paid invoice.
- User's read-only question vs explicit request to create or change a record.

## Quality gates
- No arbitrary SQL or unrestricted database access from the model.
- No secrets in prompts, logs, browser code or test fixtures.
- No cross-workspace reads or writes.
- No partial success for atomic batches.
- Idempotent retries and explicit duplicate reporting.
- Tests cover Hindi/Hinglish/English variants, typo/noisy input, multi-intent requests, ambiguity, invalid values, permissions, retries and failures.
- Production deployment and destructive schema changes require explicit approval.
