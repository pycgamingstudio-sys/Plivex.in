# Recovered production migration sources

Read-only source: Supabase project `sqzpaiibmfsvarrkwkvb`, table `supabase_migrations.schema_migrations`.

Captured: 2026-11-14  
Remote ledger entries: **47**  
Local `supabase/migrations` files on `global-dev`: **23**  
Exact version-string matches: **0**  
Remote entries with a matching local basename: **12**  
Normalized SQL body matches among those: **8 / 12**  
Historical SQL sources recovered here: **39** (35 missing by basename + 4 divergent remote versions)

## Reconciliation findings

- The 35 missing historical SQL bodies were recovered from the ledger's recorded `statements` arrays.
- Eight of twelve local files sharing a basename with a remote ledger entry have normalized SQL bodies matching the ledger source.
- Four same-basename files differ from the recorded production SQL. Their exact remote versions are archived separately here. See `manifest.json`.
- Important India risk: remote `20261113040332_basic_plan_lead_management` enables Basic lead-pipeline access in the shared `plan_features` catalogue. The local `202611130001_basic_plan_lead_management.sql` is intentionally a no-op because the catalogue is shared with India and lacks an edition discriminator. Do not blindly replay the remote source into a new environment without an explicit India entitlement decision.
- The local-only migration files remain unchanged and are not represented in the remote production ledger.

## Safety

This archive is outside `supabase/migrations`, so Supabase CLI will not automatically execute it. It is archival evidence only. No production migration, schema, data, RLS policy, grant, Edge Function, or deployment was changed. Replays must target disposable databases only.

Some recovered migrations depend on Supabase-managed Auth, Storage, Vault, pg_cron, and pg_net objects. A clean replay must provide a compatible disposable platform bootstrap; vanilla PostgreSQL success alone must not be reported as full Supabase production equivalence.
