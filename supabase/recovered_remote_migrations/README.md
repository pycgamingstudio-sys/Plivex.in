# Recovered production migration sources

Read-only source: Supabase project `sqzpaiibmfsvarrkwkvb`, table `supabase_migrations.schema_migrations`.

Captured on: 2026-11-14  
Remote ledger entries: **47**  
Local `supabase/migrations` files on `global-dev`: **23**  
Exact version-string matches: **0**  
Remote entries with a matching local basename: **12**  
Remote historical sources recovered into this archive: **35**  
Local-only migration files not represented in the remote ledger: **11**

## Reconciliation rules

- The 35 SQL files here are reconstructed from the ledger's recorded `statements` arrays, preserving each remote version and name.
- The 12 basename matches are listed in `manifest.json`. A matching name is not proof that the local file body is identical; equivalence remains unverified until SQL comparison.
- The 11 local-only files remain in `supabase/migrations`; they are candidate migrations not present in the production ledger at the time of inspection.
- The original 23 files in `supabase/migrations` were not renamed, rewritten, or deleted.

## Safety

This archive is intentionally outside `supabase/migrations`, so Supabase CLI will not automatically execute it. It is evidence/recovery material only. No production migration, schema, data, RLS policy, grant, Edge Function, or deployment was changed. Replays must target disposable databases only.

Some recovered migrations depend on Supabase-managed Auth, Storage, Vault, pg_cron, and pg_net objects. A clean replay must provide a compatible disposable platform bootstrap; vanilla PostgreSQL success alone must not be reported as full Supabase production equivalence.

See `manifest.json` for exact versions, names, paths, blob SHAs, basename mappings, and local-only files.
