# Plivex Global — Live Supabase Isolation Inventory

Audit date: 2026-11-14
Project ref: `sqzpaiibmfsvarrkwkvb`
Repository: `pycgamingstudio-sys/Plivex.in`
Branch: `global-dev`

## Scope and safety

This is a read-only inventory of the currently connected Supabase project. No SQL DDL/DML, migrations, Edge Function deployments, Auth configuration changes, DNS changes, or Worker deployments were performed.

## Live schema findings

- The requested existing Supabase project currently exposes `public` application tables; the requested `global` schema does not exist.
- 27 public application tables were returned by the schema inventory.
- The existing public schema contains active India/business data. Examples from metadata row estimates/counts include `profiles` (12), `workspace_members` (15), `subscriptions` (16), `payment_logs` (6), `invoices` (17), `invoice_items` (17), `stock` (39), `clients` (17), `expenses` (8), and `business_profile` (2). These are live records and must not be repurposed as Global tables.
- Supabase Auth contains 13 users. The Auth identity store is shared at project level; a separate Global profile/workspace namespace is needed if the same Supabase project is retained.
- The project has 32 active Edge Functions. Existing functions include shared handlers such as `ensure-owner-role`, `workspace-records`, `list-invoices`, `save-invoice`, and payment handlers. Do not overwrite these with Global-specific code.
- No Global-specific Edge Function namespace was returned in the current deployed-function inventory.

## Security advisor findings (read-only)

- `public.invoice_share_links` has RLS enabled but no policies (INFO).
- `public.execute_assistant_action_batch(text,text,jsonb)` is SECURITY DEFINER and executable by anon (WARN).
- Six SECURITY DEFINER functions are executable by authenticated users: `cancel_invoice`, `delete_draft_invoice`, `execute_assistant_action_batch`, `get_access_status`, `revenue_summary`, and `save_invoice` (WARN; each needs intended-caller review before any privilege changes).
- Leaked-password protection is disabled (WARN).
- Performance notices include an unindexed FK on `invoice_share_links.created_by` and an RLS init-plan warning on `assistant_action_batches`. Nine indexes were reported unused; no index removals are proposed from this observation alone.

## Consequences for Global launch

1. Do not run the current Global migration series against production: it changes shared `public` objects and would not establish edition isolation.
2. Do not deploy the current Global Edge Function revisions over existing function names. Use separate Global function names and schema-qualified queries.
3. Do not point `global.plivex.in` at the existing production Worker until a separate Global build and routing target exists and has passed preview smoke tests.
4. Existing Auth can remain the identity provider only if Global gets separate profile, membership, workspace and authorization records. A user's India profile/role must never grant Global privileges.
5. Cashfree provider lifecycle is deferred as requested; do not activate or test live transactions.

## Next engineering work

- Map every Global frontend call to tables, RPCs and Edge Functions.
- Design additive `global` schema tables, RLS, grants, and schema-scoped RPCs.
- Create separately named Global Edge Functions and wire Global frontend calls to them.
- Add tests for India-vs-Global and Global-workspace-vs-Global-workspace isolation.
- Run migration replay and all required CI on an exact candidate SHA before Chat 2, Chat 3 and Chat 4 release gates.

## Validation

Live project inventory and advisor queries completed successfully through read-only Supabase tools. No code tests or production changes were performed by this inventory step.
