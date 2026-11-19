# Plivex Intelligence — AI phase

## Operating contract
- Preserve existing Plivex features and workspace boundaries.
- Treat model output, user text, files, OCR and tool results as untrusted data.
- The model may propose allow-listed actions; only server validators and authenticated backend executors may write.
- A prepared draft is not a saved record. Report success only after the backend confirms and the result is verified.
- After an atomic save, the confirmation endpoint re-reads each created record within the authenticated workspace; the UI distinguishes verified saves from accepted-but-unverified outcomes.
- Ask one focused clarification when a required field or the intended business operation is genuinely ambiguous.
- Never claim a capability is live merely because its database table exists.

## Model runtime
The assistant uses the Gemini Developer API `gemini-3.8-flash` model ID with structured JSON output and medium thinking. The Edge Function allows up to 25 seconds for the provider request; the browser waits up to 30 seconds so the client does not cancel a valid reasoning response prematurely. Model output remains untrusted and is validated by the server allow-list before any confirmation can be shown.

## Current verified write surface
The `execute_assistant_action_batch` RPC and `assistant-confirm` Edge Function support six confirmed write actions: `create_client`, `create_expense`, `create_lead`, `create_stock`, `create_quotation`, `create_invoice`. A seventh action, `receive_purchase_order`, uses the existing `india_part4_receive_purchase_order` RPC, which enforces workspace role checks, purchase-order and active-warehouse membership, receipt quantity limits, atomic stock-ledger updates and idempotent retries. Goods receipt is deliberately confirmed as a single-action operation rather than mixed into a multi-action batch. The AI can receive goods only against an existing purchase order; purchase-order creation remains unsupported. The confirmation endpoint verifies the receipt header, receipt-line count and stock-ledger movement count within the authenticated workspace before reporting a verified success.

## Module coverage and honest capability status
The registry catalogs clients, invoices, inventory, expenses, quotations, leads, services, suppliers, purchase orders, purchase receipts, warehouses, stock transfers, payments, staff, branches, analytics and automation.
The assistant live context now includes bounded workspace-scoped reads for active warehouses, purchase orders, purchase-order lines, recent goods receipts and recent stock-movement metadata (movement type, quantity delta, references and timestamps), alongside the existing client, invoice, stock, expense, quotation, lead and service context. Stock movement free-text notes are deliberately excluded from the model context. Inventory history remains read-only. Purchasing/warehouse reads are informational; goods receipt is the one implemented purchasing write through the existing secured RPC. The model-facing receipt proposal is checked against exact loaded PO lines and outstanding quantities before it can be presented for confirmation. Purchase-order creation, stock transfer, supplier management, payment, staff, branch and automation writes remain unavailable until each has a permission-checked server executor and end-to-end tests.

## Read-only business analytics
- The assistant context derives overdue receivables aging buckets and oldest overdue age from loaded, non-draft open invoices.
- Inventory analytics identify low-stock candidates using each item's configured threshold and summarize recent stock movement types. Stock quantities are grouped by unit, and no combined total is reported across kilograms, pieces, litres or other units.
- Invoice and purchase-order monetary summaries are grouped by currency; a mixed-currency grand total is deliberately null rather than a misleading sum.
- Monetary receivables are deliberately not aggregated across currencies. These analytics are counts and operational indicators, not accounting ledger balances.
- Every calculation is limited to loaded workspace-scoped rows; unavailable modules and sample limits remain disclosed.
- Stock movement free-text notes are excluded from the model context to reduce prompt-injection exposure from untrusted operational notes.

## Deterministic intent assistance
- A shared, unit-tested intent helper supplies advisory hints for common business operations, Indian amount formats (including thousand/lakh/crore shorthand), and inventory quantity units.
- It explicitly separates product creation, purchase orders, goods receipts, warehouse creation, stock transfers, incoming payments and outgoing payments.
- Quantity-only inventory requests and mixed purchase/receipt requests produce explicit clarification flags instead of guessing the business event.
- These hints are fallible and never authorize writes. The model's proposal still passes strict server validation, the authenticated database executor, role checks and user confirmation.
- The helper is regression-tested for amount parsing, quantity normalization, business-operation distinctions, multiple intents, unrelated “received” wording, Hindi/Hinglish phrasing and invalid numeric values.

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
