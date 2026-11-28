-- Versioned Main Workspace public API write contract with transactional idempotency.
begin;

create table if not exists public.public_api_idempotency (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspace_settings(workspace_id) on delete cascade,
  api_key_id uuid not null references public.public_api_keys(id) on delete cascade,
  idempotency_key text not null check (length(idempotency_key) between 8 and 128 and idempotency_key ~ '^[A-Za-z0-9._:-]+$'),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending' check (status in ('pending','completed')),
  response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  unique (api_key_id, idempotency_key),
  check ((status = 'completed' and response is not null) or status = 'pending')
);
create index if not exists public_api_idempotency_expiry_idx
  on public.public_api_idempotency(expires_at);

alter table public.public_api_idempotency enable row level security;
revoke all on public.public_api_idempotency from public, anon, authenticated;
grant all on public.public_api_idempotency to service_role;
drop policy if exists public_api_idempotency_deny_client_access on public.public_api_idempotency;
create policy public_api_idempotency_deny_client_access
  on public.public_api_idempotency for all to anon, authenticated
  using (false) with check (false);

create or replace function public.main_workspace_api_create_lead(
  p_api_key_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_correlation_id uuid,
  p_name text,
  p_company text default null,
  p_email text default null,
  p_phone text default null,
  p_requirement text default null,
  p_value numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_key public.public_api_keys%rowtype;
  v_currency text;
  v_existing public.public_api_idempotency%rowtype;
  v_lead public.leads%rowtype;
  v_response jsonb;
begin
  if p_api_key_id is null
    or p_idempotency_key is null
    or length(p_idempotency_key) not between 8 and 128
    or p_idempotency_key !~ '^[A-Za-z0-9._:-]+$'
    or p_request_hash is null or p_request_hash !~ '^[a-f0-9]{64}$'
    or p_correlation_id is null
    or p_name is null
    or length(btrim(p_name)) not between 2 and 160
    or p_value is null or p_value < 0 or p_value > 999999999999 then
    return jsonb_build_object('ok',false,'error','INVALID_LEAD_REQUEST');
  end if;
  if p_email is not null and length(p_email) > 254 then
    return jsonb_build_object('ok',false,'error','INVALID_EMAIL');
  end if;
  if p_phone is not null and length(p_phone) > 32 then
    return jsonb_build_object('ok',false,'error','INVALID_PHONE');
  end if;
  if p_company is not null and length(p_company) > 160 then
    return jsonb_build_object('ok',false,'error','INVALID_COMPANY');
  end if;
  if p_requirement is not null and length(p_requirement) > 2000 then
    return jsonb_build_object('ok',false,'error','INVALID_REQUIREMENT');
  end if;

  select * into v_key
  from public.public_api_keys
  where id = p_api_key_id
    and revoked_at is null
    and expires_at > now()
    and 'leads.write' = any(scopes);
  if not found then
    return jsonb_build_object('ok',false,'error','API_KEY_OR_SCOPE_INVALID');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_key.id::text || ':' || p_idempotency_key, 0));

  select * into v_existing
  from public.public_api_idempotency
  where api_key_id = v_key.id and idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_existing.request_hash <> p_request_hash then
      return jsonb_build_object('ok',false,'error','IDEMPOTENCY_KEY_REUSED');
    end if;
    if v_existing.status = 'completed' and v_existing.response is not null then
      return jsonb_set(v_existing.response, '{replayed}', 'true'::jsonb, true);
    end if;
    return jsonb_build_object('ok',false,'error','IDEMPOTENCY_IN_PROGRESS');
  end if;

  insert into public.public_api_idempotency(
    workspace_id, api_key_id, idempotency_key, request_hash, status
  ) values (
    v_key.workspace_id, v_key.id, p_idempotency_key, p_request_hash, 'pending'
  );

  select currency_code into v_currency
  from public.workspace_settings
  where workspace_id = v_key.workspace_id;

  insert into public.leads(
    workspace_id, name, company, email, phone, requirement, value,
    stage, source, owner_id, currency_code
  ) values (
    v_key.workspace_id, btrim(p_name), nullif(btrim(p_company), ''),
    nullif(lower(btrim(p_email)), ''), nullif(btrim(p_phone), ''),
    nullif(btrim(p_requirement), ''), p_value,
    'New', 'public_api', v_key.created_by, v_currency
  )
  returning * into v_lead;

  v_response := jsonb_build_object(
    'ok', true,
    'lead', jsonb_build_object(
      'id', v_lead.id,
      'name', v_lead.name,
      'company', v_lead.company,
      'email', v_lead.email,
      'phone', v_lead.phone,
      'stage', v_lead.stage,
      'value', v_lead.value,
      'currency_code', v_lead.currency_code,
      'created_at', v_lead.created_at
    ),
    'replayed', false
  );

  update public.public_api_idempotency
  set status = 'completed', response = v_response, updated_at = now()
  where api_key_id = v_key.id and idempotency_key = p_idempotency_key;

  insert into public.workspace_audit_events(
    workspace_id, actor_id, action, entity_type, entity_id, correlation_id, outcome, metadata
  ) values (
    v_key.workspace_id, v_key.created_by, 'api.lead_created', 'lead', v_lead.id::text,
    p_correlation_id, 'success', jsonb_build_object('api_key_id', v_key.id, 'idempotency_key', p_idempotency_key)
  );

  return v_response;
end;
$function$;

revoke all on function public.main_workspace_api_create_lead(uuid,text,text,uuid,text,text,text,text,text,numeric) from public, anon, authenticated;
grant execute on function public.main_workspace_api_create_lead(uuid,text,text,uuid,text,text,text,text,text,numeric) to service_role;

select cron.schedule(
  'plivex-public-api-idempotency-cleanup',
  '15 2 * * *',
  'delete from public.public_api_idempotency where expires_at < now();'
);

commit;

    or p_correlation_id is null
    or p_name is null
    or length(btrim(p_name)) not between 2 and 160
    or p_value is null or p_value < 0 or p_value > 999999999999 then
    return jsonb_build_object('ok',false,'error','INVALID_LEAD_REQUEST');
  end if;
  if p_email is not null and length(p_email) > 254 then
    return jsonb_build_object('ok',false,'error','INVALID_EMAIL');
  end if;
  if p_phone is not null and length(p_phone) > 32 then
    return jsonb_build_object('ok',false,'error','INVALID_PHONE');
  end if;
  if p_company is not null and length(p_company) > 160 then
    return jsonb_build_object('ok',false,'error','INVALID_COMPANY');
  end if;
  if p_requirement is not null and length(p_requirement) > 2000 then
    return jsonb_build_object('ok',false,'error','INVALID_REQUIREMENT');
  end if;

  select * into v_key
  from public.public_api_keys
  where id = p_api_key_id
    and revoked_at is null
    and expires_at > now()
    and 'leads.write' = any(scopes);
  if not found then
    return jsonb_build_object('ok',false,'error','API_KEY_OR_SCOPE_INVALID');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_key.id::text || ':' || p_idempotency_key, 0));

  select * into v_existing
  from public.public_api_idempotency
  where api_key_id = v_key.id and idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_existing.request_hash <> p_request_hash then
      return jsonb_build_object('ok',false,'error','IDEMPOTENCY_KEY_REUSED');
    end if;
    if v_existing.status = 'completed' and v_existing.response is not null then
      return jsonb_set(v_existing.response, '{replayed}', 'true'::jsonb, true);
    end if;
    return jsonb_build_object('ok',false,'error','IDEMPOTENCY_IN_PROGRESS');
  end if;

  insert into public.public_api_idempotency(
    workspace_id, api_key_id, idempotency_key, request_hash, status
  ) values (
    v_key.workspace_id, v_key.id, p_idempotency_key, p_request_hash, 'pending'
  );

  select currency_code into v_currency
  from public.workspace_settings
  where workspace_id = v_key.workspace_id;

  insert into public.leads(
    workspace_id, name, company, email, phone, requirement, value,
    stage, source, owner_id, currency_code
  ) values (
    v_key.workspace_id, btrim(p_name), nullif(btrim(p_company), ''),
    nullif(lower(btrim(p_email)), ''), nullif(btrim(p_phone), ''),
    nullif(btrim(p_requirement), ''), p_value,
    'New', 'public_api', v_key.created_by, v_currency
  )
  returning * into v_lead;

  v_response := jsonb_build_object(
    'ok', true,
    'lead', jsonb_build_object(
      'id', v_lead.id,
      'name', v_lead.name,
      'company', v_lead.company,
      'email', v_lead.email,
      'phone', v_lead.phone,
      'stage', v_lead.stage,
      'value', v_lead.value,
      'currency_code', v_lead.currency_code,
      'created_at', v_lead.created_at
    ),
    'replayed', false
  );

  update public.public_api_idempotency
  set status = 'completed', response = v_response, updated_at = now()
  where api_key_id = v_key.id and idempotency_key = p_idempotency_key;

  insert into public.workspace_audit_events(
    workspace_id, actor_id, action, entity_type, entity_id, correlation_id, outcome, metadata
  ) values (
    v_key.workspace_id, v_key.created_by, 'api.lead_created', 'lead', v_lead.id::text,
    p_correlation_id, 'success', jsonb_build_object('api_key_id', v_key.id, 'idempotency_key', p_idempotency_key)
  );

  return v_response;
end;
$function$;

revoke all on function public.main_workspace_api_create_lead(uuid,text,text,uuid,text,text,text,text,text,numeric) from public, anon, authenticated;
grant execute on function public.main_workspace_api_create_lead(uuid,text,text,uuid,text,text,text,text,text,numeric) to service_role;

select cron.schedule(
  'plivex-public-api-idempotency-cleanup',
  '15 2 * * *',
  'delete from public.public_api_idempotency where expires_at < now();'
);

commit;

    or p_correlation_id is null
    or p_name is null
    or length(btrim(p_name)) not between 2 and 160
    or p_value is null or p_value < 0 or p_value > 999999999999 then
    return jsonb_build_object('ok',false,'error','INVALID_LEAD_REQUEST');
  end if;
  if p_email is not null and length(p_email) > 254 then
    return jsonb_build_object('ok',false,'error','INVALID_EMAIL');
  end if;
  if p_phone is not null and length(p_phone) > 32 then
    return jsonb_build_object('ok',false,'error','INVALID_PHONE');
  end if;
  if p_company is not null and length(p_company) > 160 then
    return jsonb_build_object('ok',false,'error','INVALID_COMPANY');
  end if;
  if p_requirement is not null and length(p_requirement) > 2000 then
    return jsonb_build_object('ok',false,'error','INVALID_REQUIREMENT');
  end if;

  select * into v_key
  from public.public_api_keys
  where id = p_api_key_id
    and revoked_at is null
    and expires_at > now()
    and 'leads.write' = any(scopes);
  if not found then
    return jsonb_build_object('ok',false,'error','API_KEY_OR_SCOPE_INVALID');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_key.id::text || ':' || p_idempotency_key, 0));

  select * into v_existing
  from public.public_api_idempotency
  where api_key_id = v_key.id and idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_existing.request_hash <> p_request_hash then
      return jsonb_build_object('ok',false,'error','IDEMPOTENCY_KEY_REUSED');
    end if;
    if v_existing.status = 'completed' and v_existing.response is not null then
      return jsonb_set(v_existing.response, '{replayed}', 'true'::jsonb, true);
    end if;
    return jsonb_build_object('ok',false,'error','IDEMPOTENCY_IN_PROGRESS');
  end if;

  insert into public.public_api_idempotency(
    workspace_id, api_key_id, idempotency_key, request_hash, status
  ) values (
    v_key.workspace_id, v_key.id, p_idempotency_key, p_request_hash, 'pending'
  );

  select currency_code into v_currency
  from public.workspace_settings
  where workspace_id = v_key.workspace_id;

  insert into public.leads(
    workspace_id, name, company, email, phone, requirement, value,
    stage, source, owner_id, currency_code
  ) values (
    v_key.workspace_id, btrim(p_name), nullif(btrim(p_company), ''),
    nullif(lower(btrim(p_email)), ''), nullif(btrim(p_phone), ''),
    nullif(btrim(p_requirement), ''), p_value,
    'New', 'public_api', v_key.created_by, v_currency
  )
  returning * into v_lead;

  v_response := jsonb_build_object(
    'ok', true,
    'lead', jsonb_build_object(
      'id', v_lead.id,
      'name', v_lead.name,
      'company', v_lead.company,
      'email', v_lead.email,
      'phone', v_lead.phone,
      'stage', v_lead.stage,
      'value', v_lead.value,
      'currency_code', v_lead.currency_code,
      'created_at', v_lead.created_at
    ),
    'replayed', false
  );

  update public.public_api_idempotency
  set status = 'completed', response = v_response, updated_at = now()
  where api_key_id = v_key.id and idempotency_key = p_idempotency_key;

  insert into public.workspace_audit_events(
    workspace_id, actor_id, action, entity_type, entity_id, correlation_id, outcome, metadata
  ) values (
    v_key.workspace_id, v_key.created_by, 'api.lead_created', 'lead', v_lead.id::text,
    p_correlation_id, 'success', jsonb_build_object('api_key_id', v_key.id, 'idempotency_key', p_idempotency_key)
  );

  return v_response;
end;
$function$;

revoke all on function public.main_workspace_api_create_lead(uuid,text,text,uuid,text,text,text,text,text,numeric) from public, anon, authenticated;
grant execute on function public.main_workspace_api_create_lead(uuid,text,text,uuid,text,text,text,text,text,numeric) to service_role;

select cron.schedule(
  'plivex-public-api-idempotency-cleanup',
  '15 2 * * *',
  'delete from public.public_api_idempotency where expires_at < now();'
);

commit;

    or p_correlation_id is null
    or p_name is null
    or length(btrim(p_name)) not between 2 and 160
    or p_value is null or p_value < 0 or p_value > 999999999999 then
    return jsonb_build_object('ok',false,'error','INVALID_LEAD_REQUEST');
  end if;
  if p_email is not null and length(p_email) > 254 then
    return jsonb_build_object('ok',false,'error','INVALID_EMAIL');
  end if;
  if p_phone is not null and length(p_phone) > 32 then
    return jsonb_build_object('ok',false,'error','INVALID_PHONE');
  end if;
  if p_company is not null and length(p_company) > 160 then
    return jsonb_build_object('ok',false,'error','INVALID_COMPANY');
  end if;
  if p_requirement is not null and length(p_requirement) > 2000 then
    return jsonb_build_object('ok',false,'error','INVALID_REQUIREMENT');
  end if;

  select * into v_key
  from public.public_api_keys
  where id = p_api_key_id
    and revoked_at is null
    and expires_at > now()
    and 'leads.write' = any(scopes);
  if not found then
    return jsonb_build_object('ok',false,'error','API_KEY_OR_SCOPE_INVALID');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_key.id::text || ':' || p_idempotency_key, 0));

  select * into v_existing
  from public.public_api_idempotency
  where api_key_id = v_key.id and idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_existing.request_hash <> p_request_hash then
      return jsonb_build_object('ok',false,'error','IDEMPOTENCY_KEY_REUSED');
    end if;
    if v_existing.status = 'completed' and v_existing.response is not null then
      return jsonb_set(v_existing.response, '{replayed}', 'true'::jsonb, true);
    end if;
    return jsonb_build_object('ok',false,'error','IDEMPOTENCY_IN_PROGRESS');
  end if;

  insert into public.public_api_idempotency(
    workspace_id, api_key_id, idempotency_key, request_hash, status
  ) values (
    v_key.workspace_id, v_key.id, p_idempotency_key, p_request_hash, 'pending'
  );

  select currency_code into v_currency
  from public.workspace_settings
  where workspace_id = v_key.workspace_id;

  insert into public.leads(
    workspace_id, name, company, email, phone, requirement, value,
    stage, source, owner_id, currency_code
  ) values (
    v_key.workspace_id, btrim(p_name), nullif(btrim(p_company), ''),
    nullif(lower(btrim(p_email)), ''), nullif(btrim(p_phone), ''),
    nullif(btrim(p_requirement), ''), p_value,
    'New', 'public_api', v_key.created_by, v_currency
  )
  returning * into v_lead;

  v_response := jsonb_build_object(
    'ok', true,
    'lead', jsonb_build_object(
      'id', v_lead.id,
      'name', v_lead.name,
      'company', v_lead.company,
      'email', v_lead.email,
      'phone', v_lead.phone,
      'stage', v_lead.stage,
      'value', v_lead.value,
      'currency_code', v_lead.currency_code,
      'created_at', v_lead.created_at
    ),
    'replayed', false
  );

  update public.public_api_idempotency
  set status = 'completed', response = v_response, updated_at = now()
  where api_key_id = v_key.id and idempotency_key = p_idempotency_key;

  insert into public.workspace_audit_events(
    workspace_id, actor_id, action, entity_type, entity_id, correlation_id, outcome, metadata
  ) values (
    v_key.workspace_id, v_key.created_by, 'api.lead_created', 'lead', v_lead.id::text,
    p_correlation_id, 'success', jsonb_build_object('api_key_id', v_key.id, 'idempotency_key', p_idempotency_key)
  );

  return v_response;
end;
$function$;

revoke all on function public.main_workspace_api_create_lead(uuid,text,text,uuid,text,text,text,text,text,numeric) from public, anon, authenticated;
grant execute on function public.main_workspace_api_create_lead(uuid,text,text,uuid,text,text,text,text,text,numeric) to service_role;

select cron.schedule(
  'plivex-public-api-idempotency-cleanup',
  '15 2 * * *',
  'delete from public.public_api_idempotency where expires_at < now();'
);

commit;
