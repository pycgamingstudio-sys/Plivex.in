# Part 7–8 implementation notes

This branch is an isolated implementation candidate based on `global-dev`. It does not deploy migrations or change production.

## Part 7 foundations added
- Explicit currency minor-unit precision metadata for a constrained ISO 4217 allow-list.
- Rational, integer-only FX conversion using numerator/denominator snapshots; conversion output retains the source snapshot identifier, timestamps, rate and rounding mode.
- A verified tax-rule snapshot validator and effective-date/jurisdiction resolver. Sources are restricted to country-appropriate official government/tax domains.
- A country capability matrix that distinguishes the India legacy path, standard-rate-only support and jurisdiction-adapter requirements.

## Part 8 foundations added
- Additive private-schema tables for branches, per-member/per-role permission overrides, approval requests, append-only audit events, export jobs, retention settings and rate-limit counters.
- RLS enabled with membership/admin read policies; the Global schema remains unexposed to PostgREST.
- Service-role-only RPCs re-check active workspace membership and perform enterprise mutations and audit writes in one database transaction.
- An authenticated Edge Function applies a per-user rate limit before delegating to the guarded RPC.

## Deliberate limitations
- This is not a tax-compliance certification. A rule marked verified must be reviewed and published through a controlled server-side process; country selection alone never establishes registration, nexus or collection obligation.
- FX rates are not fetched from an invented provider. The code accepts only explicit, source-attributed rational snapshots.
- Export jobs are queued, but a secure export worker, signed-download delivery, expiry cleanup and retention enforcement still require implementation and end-to-end verification.
- Branch records and approval metadata are present, but branch assignment has not yet been wired into every business record/invoice workflow.
- The existing India GST code path has not been modified.
- The migration is a candidate only; no live Supabase DDL was applied.
