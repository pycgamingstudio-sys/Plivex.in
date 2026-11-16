# FINAL PLIVEX — Part 9: All Blueprint Completion

Status: execution backlog; NOT a completion claim.

## Release rules
- One canonical site and one application. Preserve India production and existing customer data.
- Work only on `feat/part9-blueprint-completion`; do not merge, deploy, apply hosted migrations, or change production secrets without explicit release approval.
- Reuse existing modules. Every item must be classified as COMPLETE, PARTIAL, MISSING, BROKEN, or NOT VERIFIED using code and test evidence before implementation.
- "Premium" means dependable workflows, accessibility, clear errors, auditability, tenant isolation, recoverability, and documented limitations—not feature-count parity or marketing claims.
- Country support is enabled only when the exact tax/payment/document treatment is verified for that country and jurisdiction.

## Known carry-over from Part 8 report (must be closed or explicitly release-blocked)
1. Approval requests are not yet blocking invoice/expense mutations.
2. Branch IDs are not attached to every business record; branch-level isolation is incomplete.
3. Operational health is a request-time database snapshot, not continuous monitoring/alerting.
4. Permission enforcement across every legacy/India business-record route is not claimed.
5. Production-backup restore drill and independent security review remain release gates.

## Workstream A — approval and enterprise governance
- Define an approval policy model (workspace, record type, action, amount/threshold, requester exclusions, approver roles, quorum, expiry, cancellation, escalation).
- Enforce approval server-side in the same transaction as protected mutations; reject bypasses from direct RPC/Edge/API calls.
- Make requests immutable/auditable; idempotent decisions; prevent self-approval where policy requires; handle stale records and concurrent decisions.
- Add integration tests for allow/deny, role changes, revoked membership, race conditions, retries, cancellation, expiry, and bypass attempts.

## Workstream B — branches and data scope
- Introduce branch ownership/association for supported business records with safe nullable/backfill strategy.
- Enforce workspace + branch scope in database constraints, RLS, RPCs, Edge Functions, exports, reports, and search.
- Define explicit cross-branch roles and consolidated reporting; never infer branch access from client input.
- Test cross-branch and cross-tenant read/write/export denial, branch deletion, reassignment, and legacy records.

## Workstream C — security and operational reliability
- Inventory every India and Global route, RPC, Edge Function, storage bucket, export and scheduled job; verify authorization at server boundary.
- Add automated authorization matrix tests, abuse/rate-limit tests where supported, webhook signature/replay/idempotency tests, and secret-handling checks.
- Add actionable health signals and alert integration only where a supported low-cost provider exists; otherwise document operator-run checks and do not claim continuous monitoring.
- Perform restore drill from a real production backup only with owner approval, isolated target, access controls and data-handling safeguards.
- Obtain independent security review before launch; record findings and remediation evidence.

## Workstream D — remaining product blueprint (audit first; build only missing/partial)
### Invoice and documents
- Custom fields/labels/templates/branding, recurring lifecycle, correction/credit-note handling, numbering and immutable issued snapshots, currency-safe input, robust multi-page PDF, accessible mobile preview.
### CRM and customer operations
- Configurable pipelines, scoring, deduplication, activity timeline, follow-up automation, lead-to-quote-to-invoice-to-payment traceability.
### Inventory and procurement
- Multi-warehouse transfers, SKU/barcode/variants, batches/expiry, reorder controls, valuation, purchase orders, partial receipts, returns and accounting linkage.
### Accounting and reconciliation
- Bank statement import/matching, exception handling, reconciliation locking/audit, multi-currency reporting and corrections; preserve balanced append-only journals.
### Client portal
- Secure expiring/revocable customer access, invoice/quote viewing, approval, payment status/receipts, comments and document history.
### AI and automation
- Structured intent/action contracts, confidence thresholds, permission gates, preview/approval, idempotent execution, evidence-backed answers, retry/dead-letter handling and full audit trail.
### Integration platform
- Versioned public API, scoped/revocable API keys, signed webhooks, delivery retries/replay controls, event catalog, developer docs and sandbox.
### SaaS subscriptions
- Entitlements, usage metering, upgrade/downgrade, renewal/cancellation, grace/recovery, provider webhook reconciliation and subscription audit.
### BI and command center
- Reconciled metrics, saved/custom reports, drill-down, scheduled summaries, freshness indicators and actionable cross-module overview.
### Global readiness
- Country-by-country verified tax/document/payment capability matrix, jurisdiction-effective rules, local formats, language/date/number/address behavior and clear unsupported-country handling.

## Implemented candidate slice — Global expense approval gates

Implemented on this Part 9 branch in `20261116170000_part9_expense_approval_gates.sql`:
- Workspace-scoped approval policies for expense creation and material expense updates.
- Owner/admin-only policy configuration through the authenticated Global Enterprise Edge Function, with validated minimum amount, eligible approver roles and self-approval prevention.
- Database BEFORE triggers enforce the gate for all write paths, including direct service-role RPC inserts/updates; a UI-only check cannot bypass it.
- Approval must match the resource key, action, amount, category, vendor, expense date and currency, and must be decided by an active member with an allowed role. Approved requests are atomically consumed once and cannot be replayed.
- Disposable integration test covers blocked unapproved create/update and successful approved create/update.
- Candidate migration is included in migration replay manifest and replay test script.

**Scope:** this slice currently covers Global expense create/update only. It does not yet gate invoice issue/payment, India routes, or every other protected mutation. A workspace policy must be configured to enable the gate. The Part 9 branch remains unreleased.

## Required execution protocol
For each candidate feature:
1. Trace existing frontend, database, RLS, Edge Functions, integrations and tests.
2. Record current state and evidence; avoid duplicate modules.
3. Implement the smallest complete vertical slice (UI + server enforcement + data model + audit + tests).
4. Run relevant unit, integration, migration replay/rollback, build, lint/type and India regression checks.
5. Fix failures and rerun the affected suites.
6. Mark COMPLETE only with test evidence; otherwise keep PARTIAL/NOT VERIFIED and list the blocker.

## Release acceptance gates
- No cross-tenant or unauthorized cross-branch access in automated tests.
- All protected mutations enforce approvals server-side.
- India GST and existing India workflows regressions pass.
- Global tax/payment claims limited to verified country/jurisdiction/provider combinations.
- Ledger invariants and payment/refund idempotency pass.
- Client portal access expiry/revocation and quote approval tests pass.
- API/webhook authentication, signature, replay and retry tests pass.
- Backup/restore drill and independent security review documented.
- Production smoke test performed only after explicit approval; no deployment is implied by CI success.

## Initial scope sequencing
P0: close Part 8 governance/security carry-over (approval enforcement, branch scope, India route authorization inventory).
P1: client portal and secure quote/invoice lifecycle; bank reconciliation.
P1: integration API/webhooks and subscription entitlement audit.
P2: CRM/inventory/BI/AI upgrades found missing by evidence-based audit.
P2: country-by-country readiness and localization gaps.
Final: independent security review, approved restore drill, full regression and release evidence.

## Explicit non-goals
- No second website, Global subdomain, second Supabase project, or duplicate modules.
- No fake/demo functionality presented as production-ready.
- No unsupported global tax certification or payment-provider availability claims.
- No production migration, secret changes, merge or deployment without explicit approval.

This document is a work plan. It is not evidence that any listed workstream is implemented or complete.
