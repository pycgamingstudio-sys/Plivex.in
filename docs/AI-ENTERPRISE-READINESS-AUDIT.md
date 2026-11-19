# Plivex Intelligence — Enterprise Readiness Audit

**Audit date:** 2026-11-19  
**Scope:** Read-only Supabase advisor review and first-pass inspection of callable SECURITY DEFINER functions for the Plivex AI workstream.  
**Environment:** Connected Supabase project `sqzpaiibmfsvarrkwkvb`. No schema, auth, function, secret, deployment, or production setting was changed by this audit.

## Executive result

The assistant branch's automated CI workflows are green, but automated code tests are not equivalent to authenticated end-to-end or security certification. The live Supabase advisors report several existing project-wide findings. These findings must be triaged before calling the platform enterprise-ready.

## Security advisor findings

| Finding | Count / status | Interpretation and required action |
|---|---:|---|
| RLS enabled with no policies | 10 tables (INFO) | RLS blocks ordinary client access when no policy applies. Confirm each table is intentionally service-only or add narrowly scoped policies only after reviewing its access model. Findings include `global.invoice_number_sequences`, `global.invoice_share_links`, `global.invoice_share_rate_limits`, `global.quotation_items`, `global.quotations`, `global.workspace_country_change_events`, two `private.country_reset_*` tables, and two `public.invoice_share_*` tables. |
| Authenticated execution of SECURITY DEFINER functions | 13 functions (WARN) | This is a review warning, not proof of a vulnerability. The advisor reported that all 13 are executable by `authenticated`; the SQL privilege check found none executable by `anon`. A first-pass catalogue query found each references `auth.uid()` and contains a workspace-guard marker, with fixed function-level `search_path` settings. Review each complete function body, role matrix, object ownership, and grants before deciding whether to retain, move, or revoke execution. Do not blindly revoke application RPCs. |
| Leaked-password protection disabled | 1 Auth setting (WARN) | Enable through the Supabase Auth security configuration after product-owner approval and a rollout check. This audit did not change Auth settings. |

### SECURITY DEFINER review notes

The functions identified by the advisor are:

- `cancel_invoice`
- `delete_draft_invoice`
- `execute_assistant_action_batch`
- `get_access_status`
- `global_get_financial_statements`
- `global_get_general_ledger`
- `global_get_trial_balance`
- `global_list_purchase_bills`
- `india_part4_create_purchase_order`
- `india_part4_receive_purchase_order`
- `india_part4_transfer_stock`
- `revenue_summary`
- `save_invoice`

Selected bodies were inspected in detail. In particular, Global financial/reporting functions check authenticated workspace membership; the Global purchase-bill listing binds the supplied user ID to `auth.uid()` and checks active membership; India purchase-order creation checks the caller's workspace role. This is a first-pass review, not a substitute for a complete line-by-line review and negative authorization tests for all 13 functions.

## Performance advisor findings

| Finding | Count / status | Required action |
|---|---:|---|
| Unindexed foreign keys | 81 (INFO) | Rank by query plans and workload; add only indexes justified by actual joins/deletes/updates. |
| Auth RLS initialization-plan warnings | 2 (WARN) | Review policies and use stable scalar subqueries for auth calls where appropriate; test policy semantics after any change. |
| Unused indexes | 55 (INFO) | Do not drop solely because they are currently unused; some modules may be seasonal or newly introduced. Validate usage window, query plans and write overhead first. |
| Multiple permissive policies | 4 (WARN) | Review policy overlap and consolidate only when equivalent authorization semantics are proven. |

The health advisor returned no lints at the time of this audit.

## AI-specific acceptance gates still open

1. Run a non-production live Gemini request using the stored secret without exposing the secret in logs, browser code, prompts, or test output.
2. Run authenticated E2E tests for every currently supported write action, including role denial, cross-workspace isolation, duplicate retry, invalid input, UI refresh and post-write verification.
3. Exercise provider timeout, malformed model output, partial dependency failure, cancellation and recovery paths.
4. Review every SECURITY DEFINER function and every no-policy RLS table against intended access.
5. Add workload-informed indexes and policy improvements only after query-plan review.
6. Run multilingual acceptance tests with real human-authored Hindi/Hinglish/English phrasing and noisy voice-to-text examples.
7. Complete performance/load testing and validate monitoring, alerting and incident recovery.

## Release boundary

- PR #139 remains draft and unmerged.
- No production migration was applied.
- No Edge Function was deployed.
- No production setting or secret was changed.
- Merge, production migrations, Edge Function deployment and production configuration changes remain approval-gated.

**Conclusion:** The codebase has a substantial AI foundation and green automated workflows. Enterprise readiness remains unproven until the live integration, authenticated E2E, complete security review, failure testing and performance gates above pass.


## Product naming update
The user confirmed the assistant's name as **Plivex Nova** (short name: **Nova**). The assistant system identity and user-facing widget labels have been updated on the development branch. This is branding only; it does not imply additional connected capabilities.
