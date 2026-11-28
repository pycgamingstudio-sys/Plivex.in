-- Stage 2: atomically convert a CRM lead into a Main Workspace client.
begin;
create or replace function public.main_workspace_convert_lead_to_client(
  p_workspace_id text,
  p_lead_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_user uuid := auth.uid();
  v_lead public.leads%rowtype;
  v_client_id uuid;
begin
  if v_user is null or not public.has_ws_role(
    p_workspace_id,
    array['admin'::app_role, 'manager'::app_role, 'employee'::app_role]
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select * into v_lead
  from public.leads
  where workspace_id = p_workspace_id and id = p_lead_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'lead_not_found');
  end if;

  if v_lead.client_id is not null then
    return jsonb_build_object(
      'ok', true, 'client_id', v_lead.client_id, 'duplicate', true
    );
  end if;

  if lower(coalesce(v_lead.stage, '')) = 'lost' then
    return jsonb_build_object('ok', false, 'reason', 'lost_lead_cannot_convert');
  end if;

  if length(btrim(coalesce(v_lead.name, ''))) < 1 then
    return jsonb_build_object('ok', false, 'reason', 'lead_name_required');
  end if;

  insert into public.clients (
    workspace_id, name, company, email, phone
  ) values (
    p_workspace_id,
    btrim(v_lead.name),
    nullif(btrim(coalesce(v_lead.company, '')), ''),
    nullif(btrim(coalesce(v_lead.email, '')), ''),
    nullif(btrim(coalesce(v_lead.phone, '')), '')
  )
  returning id into v_client_id;

  update public.leads
  set client_id = v_client_id, stage = 'Won', updated_at = now()
  where workspace_id = p_workspace_id and id = p_lead_id;

  insert into public.lead_activities (
    workspace_id, lead_id, activity_type, body, created_by
  ) values (
    p_workspace_id, p_lead_id, 'note',
    'Lead converted to client ' || v_client_id::text, v_user
  );

  return jsonb_build_object('ok', true, 'client_id', v_client_id, 'duplicate', false);
end;
$function$;

revoke all on function public.main_workspace_convert_lead_to_client(text, uuid)
  from public, anon;
grant execute on function public.main_workspace_convert_lead_to_client(text, uuid)
  to authenticated;
commit;
