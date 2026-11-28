-- Allow the documented leads.write capability in Main Workspace public API keys.
-- The API edge handler and idempotent lead RPC already enforce this scope explicitly.
begin;

alter table public.public_api_keys
  drop constraint if exists public_api_keys_scopes_check,
  drop constraint if exists public_api_keys_scopes_check1;

alter table public.public_api_keys
  add constraint public_api_keys_scopes_cardinality_check
    check (cardinality(scopes) between 1 and 9),
  add constraint public_api_keys_scopes_allowlist_check
    check (scopes <@ array[
      'workspace.read',
      'invoices.read',
      'clients.read',
      'expenses.read',
      'leads.read',
      'leads.write',
      'inventory.read',
      'suppliers.read',
      'mcp.read'
    ]::text[]);

commit;
