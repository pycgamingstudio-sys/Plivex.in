-- Stage 2 governance: record CRM lead lifecycle changes without copying customer PII.
begin;

alter table public.workspace_audit_events
  add column if not exists correlation_id uuid,
  add column if not exists outcome text not null default 'success';

create index if not exists workspace_audit_events_correlation_idx
  on public.workspace_audit_events (workspace_id, correlation_id)
  where correlation_id is not null;

create or replace function public.audit_main_workspace_crm_lead_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_workspace_id text;
  v_lead_id uuid;
  v_action text;
  v_metadata jsonb;
begin
  if tg_op = 'DELETE' then
    v_workspace_id := old.workspace_id;
    v_lead_id := old.id;
    v_action := 'crm.lead_deleted';
    v_metadata := jsonb_build_object(
      'previous_stage', old.stage,
      'previous_owner_id', old.owner_id
    );
  elsif tg_op = 'INSERT' then
    v_workspace_id := new.workspace_id;
    v_lead_id := new.id;
    v_action := 'crm.lead_created';
    v_metadata := jsonb_build_object(
      'stage', new.stage,
      'owner_id', new.owner_id,
      'source', new.source
    );
  else
    v_workspace_id := new.workspace_id;
    v_lead_id := new.id;
    v_action := case
      when old.client_id is null and new.client_id is not null then 'crm.lead_converted'
      when old.owner_id is distinct from new.owner_id then 'crm.lead_reassigned'
      when old.stage is distinct from new.stage then 'crm.lead_stage_changed'
      else 'crm.lead_updated'
    end;
    v_metadata := jsonb_build_object(
      'previous_stage', old.stage,
      'stage', new.stage,
      'previous_owner_id', old.owner_id,
      'owner_id', new.owner_id,
      'client_id', new.client_id
    );
  end if;

  insert into public.workspace_audit_events (
    workspace_id, actor_id, action, entity_type, entity_id, metadata, outcome
  ) values (
    v_workspace_id, auth.uid(), v_action, 'lead', v_lead_id::text, v_metadata, 'success'
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

revoke all on function public.audit_main_workspace_crm_lead_change()
  from public, anon, authenticated;

drop trigger if exists trg_audit_main_workspace_crm_lead_change on public.leads;
create trigger trg_audit_main_workspace_crm_lead_change
after insert or update or delete on public.leads
for each row execute function public.audit_main_workspace_crm_lead_change();

commit;
