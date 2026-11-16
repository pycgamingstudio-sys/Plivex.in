# Part 7 — Global tax, currency and country foundations

This is an isolated implementation candidate based on `global-dev`. It does not deploy migrations or change production.

## Implemented in this candidate
- Allow-listed currency minor-unit precision with own-property checks; integer/rational FX conversion and exact locale-aware formatting.
- Versioned tax-rule validation with country/currency pairing, official-source host restrictions, exact jurisdiction resolution, effective dates and duplicate/overlap protection at publication.
- Server-only tax-rule publication gate and append-only tax-calculation audit storage in an additive candidate migration.
- Integer-only tax calculation arithmetic with overflow rejection; explicit seller registration/effective-date and US/Canada jurisdiction/collection-obligation gates.
- Country invoice checklists for GB, AE, AU and SG; US/Canada return jurisdiction-review-required rather than generic invoice assumptions.
- Capability matrix clearly distinguishes legacy India handling, limited country checklists and unsupported tax treatments.
- Global Enterprise navigation and workspace controls for branches, approval requests, role permission overrides, audit history, operational health, private exports and retention.
- Export permissions are revalidated at queue claim and download, including full-account and audit-log restrictions. Requesters can cancel their own pending approvals.
- Audit-event updates and direct deletes are rejected; retention deletion is allowed only through the privileged cleanup function.

## Part 8 coverage in this candidate
- Workspace branch create/list/archive with workspace-scoped constraints.
- Server-side role/member permission override evaluation; service-role-only privileged RPCs and Edge Function authentication.
- Approval request, decision and requester-cancellation records with audit events.
- Workspace audit history and operational health counters.
- Private Storage export jobs, bounded datasets, SHA-256 checksums, short-lived signed URLs and retention expiry.
- Workspace-specific rate limiting and RLS/tenant-isolation integration coverage.
- Disposable migration replay and rollback checks include the enterprise hardening migration.

## Country readiness
India remains on the existing GST implementation. GB/AE/AU/SG have standard-rate-only foundations and invoice checklists; US/Canada require verified local jurisdiction rules. UAE foreign-currency tax invoice calculation and line rounding are not implemented. Global invoices remain draft-only and are not multi-currency.

## Explicit remaining Part 8/release gates
- Approval records are not yet automatic blocking gates on invoice/expense mutations; the UI labels this limitation.
- Branch IDs are not yet wired through every business record, so branches are workspace-level structure, not complete per-branch data partitioning.
- Operational health is a request-time database snapshot, not full alerting/uptime/backup monitoring. A verified backup-restore drill and independent security review remain outstanding.
- Permission enforcement across every legacy/India business-record route is not claimed. India production routes remain unchanged.
- No production migration, production deployment, or live tenant-data migration has been performed.

This is not a worldwide tax-compliance certification or a production-readiness declaration.
