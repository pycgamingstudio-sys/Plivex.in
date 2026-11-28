-- Allow the documented leads.write capability in Main Workspace public API keys.
-- The API edge handler and idempotent lead RPC already enforce this scope explicitly.
begin;

alter table public.public_api_keys
  drop constraint if exists public_api_keys_scopes_check,
  drop constraint if exists public_api_keys_scopes_check1;

-- Historical migrations created unnamed CHECK constraints, whose generated
-- names can differ when the table was first created on different DB histories.
-- Remove every existing CHECK that constrains scopes before installing the
-- canonical, named allowlist and cardinality constraints below.
do $stage3_scope_constraints$
declare
  v_constraint record;
begin
  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.public_api_keys'::regclass
      and contype = 'c'
      and position('scopes' in pg_get_constraintdef(oid)) > 0
  loop
    execute format('alter table public.public_api_keys drop constraint %I', v_constraint.conname);
  end loop;
end;
$stage3_scope_constraints$;

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
