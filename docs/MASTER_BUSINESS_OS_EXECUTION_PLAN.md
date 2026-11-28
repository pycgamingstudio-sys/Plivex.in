# Plivex Master Business OS Execution Plan

Status: architecture and implementation plan; not a claim that the listed capabilities are already shipped or verified.
Scope: preserve the Main Workspace and all seven supported countries (IN, US, GB, AE, CA, AU, SG). Preserve every current price, checkout identifier, customer record, and existing customer entitlement. Do not remove existing functionality.

## Product strategy

Position Plivex as an international Business OS for small and growing businesses: sales, customers, inventory, procurement, finance, tax/compliance, team operations, integrations, and Plivex Nova. Compete on a connected workflow and dependable execution rather than a long feature checklist.

## Non-negotiable release controls

1. No production tax rule is promoted from draft to verified without country/jurisdiction-specific source review, effective-date review, calculation tests, and a recorded reviewer.
2. Never change displayed prices or provider price IDs as part of feature packaging. Resolve UI/backend minor-unit discrepancies by proving the intended amount against the provider configuration before changing either side.
3. Existing paid customers retain their current access through a grandfathered entitlement version. New tier mapping applies only to new subscriptions or an explicitly scheduled migration with a rollback path.
4. Core invoice/quotation tax calculation, data export, account security, and access to customer-owned data are not artificial Pro-only features.
5. All write operations require server-side authorization, workspace scoping, validation, idempotency, auditability, and post-action verification.
6. External integrations (IRP/GSP, bank feeds, WhatsApp, SMS, e-signature, Paddle/Cashfree) must be labelled accurately as live, manual, or planned. Never imply a manual metadata field is a live government integration.
7. Usage limits for expensive AI/OCR/messaging/API features must be transparent, measurable, and enforced server-side. Never promise unlimited use without cost evidence.
8. Roll out through isolated branches, tests, draft PRs, staged deployment, smoke tests, and rollback. Do not bypass failed checks to reach production.

## Proposed product packaging (independent of the current implementation)

### Free — Business Starter
Core invoicing and quotations; customer and product/service records; basic inventory and low-stock visibility; expense records; payment status; PDFs and share links; essential dashboard; basic export; verified country tax calculation; limited Nova assistance for reading, explanations, and drafting. Keep Free useful enough to activate and retain businesses.

### Basic — Business Growth
Everything in Free; lead pipeline and follow-ups; practical CRM; supplier records; purchase orders and basic goods receipt; recurring invoice scheduling; email reminders; standard operational reports; accounting summaries; a measured Nova action allowance; limited OCR where unit costs are known.

### Pro — Business Scale
Everything in Basic; advanced CRM and sales automation; multi-warehouse transfers and batch/serial workflows; supplier portal and advanced procurement; full double-entry accounting, ledgers, trial balance, bank reconciliation and financial statements; advanced GST return preparation/reconciliation; multi-currency; team roles, branches, approvals, delegation and audit; custom reports; WhatsApp automation; advanced OCR/e-sign workflow; scoped API/MCP; advanced Nova multi-step workflows and automation.

## 52-point delivery matrix

### Product and competitive parity
1. Feature inventory baseline — completed as a repository/database inventory only; not end-to-end verification.
2. Refrens gap matrix — compare workflows and outcomes, not just menu labels; identify parity, differentiation, and missing dependencies.
3. Main Workspace E2E — map onboarding-to-invoice-to-payment-to-books lifecycle, workspace isolation, country selection, and error recovery.
4. Navigation — retain current Main Workspace; make desktop information architecture coherent and mobile Home/Sales/Books/AI/More task-oriented.
5. Industry workflows — create configurable templates for retail, services, wholesale/distribution, and professional services without hard-coded industry forks.
6. Document management — central document vault, versioning, access controls, retention, and export.
7. Sales documents — invoice, quotation, proforma, order, challan, credit/debit note, recurring schedule, payment link, and conversion lineage.
8. CRM — lead stages, scoring, follow-ups, activities, pipeline reporting, and conversion tracking.
9. Customer/supplier — unified profiles, contacts, tax identity, balances, transaction history, notes, and onboarding validation.
10. Onboarding/discovery — country-aware setup checklist, sample data clearly labelled, contextual empty states, and progressive feature discovery.

### Finance and compliance
11. Tax rules — verify authoritative source, jurisdiction, treatment, effective dates, components, rounding, and reviewer metadata before publication.
12. Seven-country tax — country adapters and regression suites for IN, US, GB, AE, CA, AU, SG; block taxable issuance where no verified rule exists.
13. GST/TDS — separate calculation, withholding, reporting, reconciliation, and statutory reference workflows.
14. GSTR-1 — prepare, validate, export, reconcile amendments/credit notes, and track filing status.
15. GSTR-2B/ITC — import source files, normalize supplier invoices, match purchase records, flag exceptions, and preserve audit evidence.
16. GSTR-3B/calendar — derive worksheet totals from reconciled books and provide due-date reminders; filing submission only through verified authorized integration.
17. E-invoice/e-way bill — distinguish manual IRN/acknowledgement storage from live IRP/GSP generation; implement provider adapters only after credentials and sandbox tests.
18. Double-entry — enforce balanced journal postings, immutable posted entries, reversals, and source-document linkage.
19. Chart/ledger — country-aware chart templates, account mapping, general ledger, trial balance, and period locks.
20. Bank reconciliation — secure statement import, duplicate detection, matching rules, manual review, and reconciliation audit trail.
21. Financial statements — balance sheet, profit/loss, cash flow, comparative periods, and traceable drill-down.
22. Cash flow/ageing — receivable/payable ageing, cash forecast assumptions, overdue reminders, and accuracy checks.
23. Payments — provider-neutral payment state machine, signed webhook verification, idempotency, refund/dispute handling, and reconciliation.
24. Invoice/quotation tax — identical server-side country/jurisdiction resolver, tax snapshot persistence, rounding consistency, and cross-country fixtures.

### Inventory and operations
25. Multi-warehouse — location-level stock ledger, reservations, availability, and permission-aware views.
26. Batch/serial — traceability, expiry, warranty, and recall-friendly audit.
27. Transfers — source/destination validation, in-transit state, receive/shortage handling, and atomic stock movement.
28. PO/GRN — supplier order, partial receipt, quality/variance, landed cost, and bill matching.
29. Supplier portal — scoped supplier access, onboarding, document submission, PO visibility, and revocation.
30. Sales fulfilment — sales orders, delivery challans, returns, credit/debit notes, and document linkage.
31. Roles/permissions — centralized permission matrix, least privilege, workspace membership checks, and server-side enforcement.
32. Branches — branch-scoped documents, stock, reporting, and consolidated owner view.
33. Approvals — configurable thresholds, sequential/parallel approvals, escalation, and immutable decisions.
34. Delegation — time-bounded, scoped delegation with revocation and audit.
35. Audit/export — actor, action, before/after metadata, export jobs, retention policy, and access logs.

### Nova AI and integrations
36. Conversational assistant — stable intent registry, clarification flow, safe drafts, and explicit confirmation before writes.
37. Language/voice — Hindi, Hinglish, and English detection; user-selectable language; accessible speech input; never force a single locale.
38. Image/document intelligence — OCR extraction with confidence, source image retention controls, human review, and no silent posting.
39. Business context — workspace-scoped retrieval, freshness labels, permissions filtering, and explicit context provenance.
40. Multi-step planner — dependency graph, preview, bounded batches, rollback/compensation where possible, and clear partial-failure reporting.
41. Approval/idempotency — server validation, unique request keys, duplicate protection, audit events, and verified result refresh.
42. AI analytics — explainable metrics, source/time windows, filters, and clear distinction between facts and forecasts.
43. AI cost controls — per-workspace metering, model fallback policy, budgets, rate limits, abuse controls, and transparent quotas.
44. Automation — event triggers, conditions, approvals, retry policy, dead-letter visibility, and execution history.
45. API/webhooks — scoped keys, rotation, signing, rate limits, replay protection, versioning, and developer docs.
46. MCP — scoped tools, explicit user authorization, action confirmation, auditability, and safe tool schemas.

### Pricing, growth, and retention
47. Entitlement registry — one versioned source of truth shared by UI, RPCs, and Edge Functions; unknown capabilities default deny without removing grandfathered access.
48. Free mapping — useful starter workflows, clear limits, and no lockout of existing records or core tax.
49. Basic mapping — growth workflows with explicit limits and transparent upgrade value.
50. Pro mapping — advanced operations and automation; avoid gating security, data portability, or core correctness.
51. Grandfathering — snapshot existing customer entitlements, effective dates, migration preview, reconciliation, and rollback.
52. Commercial engine — preserve all current prices; reconcile country/currency/minor-unit values across display and provider; test checkout; add upgrade/downgrade/proration policy, activation/onboarding metrics, referral attribution, country marketing, conversion/churn/revenue analytics.

## Release sequence and exit gates

- Wave 0: baseline, branch isolation, tests, pricing/checkout invariant tests, entitlement compatibility tests.
- Wave 1: tax correctness and payment correctness; no country tax release without verified rule coverage and invoice/quotation parity.
- Wave 2: central entitlement registry and server-side authorization with grandfathering.
- Wave 3: Main Workspace navigation, CRM, sales documents, inventory/procurement, finance reporting.
- Wave 4: Nova language, actions, metering, OCR and automation.
- Wave 5: integrations, compliance provider adapters, onboarding, growth analytics.

Each wave exits only when build/lint/type checks, unit/integration tests, security review, workspace isolation tests, and targeted smoke tests pass. Any payment, tax, entitlement, or RLS failure blocks rollout.

## Known blockers from the audit that must be resolved first

- All 88 seeded tax rules were observed in draft status. Do not promote them in bulk.
- Non-India taxable invoice issuance currently depends on verified country rules; maintain the safe block until the relevant rules are reviewed and tests pass.
- Australia display and Paddle checkout values must be reconciled against the actual Paddle price object and intended customer-facing amount; do not guess or change prices.
- Plan definitions are duplicated across UI, client paywall, and database. Centralize gradually with compatibility mapping.
- AI/Business Tools server-side entitlement and usage enforcement needs a complete action-by-action inventory.
- Security advisor findings require review of each SECURITY DEFINER function and RLS-enabled table; do not mass-change policies or indexes.
- Voice input locale and model fallback configuration need tests; do not expose or log provider secrets.

## Verification ledger

A checklist item is complete only when code is merged/deployed as applicable and its tests or operational evidence are recorded. A repository feature, database table, UI card, or Edge Function alone is not proof of a working end-to-end feature.
