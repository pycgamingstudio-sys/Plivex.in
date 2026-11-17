-- Ready Plivex: country-aware commercial issuance and secure immutable Global share links.
-- Tax invoices remain separately gated by the existing verified GB VAT adapter.
begin;

create table if not exists global.invoice_share_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  invoice_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  share_snapshot jsonb not null check (jsonb_typeof(share_snapshot) = 'object'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  last_accessed_at timestamptz,
  access_count bigint not null default 0 check (access_count >= 0),
  foreign key (workspace_id, invoice_id)
    references global.invoices(workspace_id, id) on delete restrict
);
create index if not exists global_invoice_share_links_invoice_idx
  on global.invoice_share_links(workspace_id, invoice_id, created_at desc);
create index if not exists global_invoice_share_links_expiry_idx
  on global.invoice_share_links(expires_at) where revoked_at is null;
alter table global.invoice_share_links enable row level security;
revoke all on global.invoice_share_links from public, anon, authenticated;
grant all on global.invoice_share_links to service_role;
create table if not exists global.invoice_share_rate_limits (
 key_hash text primary key check (key_hash ~ '^[0-9a-f]{64}

-- Commercial invoices are a document workflow, not a claim of tax calculation.
-- This RPC is available for the six non-India Global workspaces with their exact
-- registered base currency. The UK VAT tax-invoice RPC remains a separate path.
create or replace function public.global_issue_commercial_invoice(
  p_user_id uuid,
  p_workspace_id uuid,
  p_invoice_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, global
as $function$
declare
  v_role text;
  v_workspace global.workspaces%rowtype;
  v_profile global.business_profiles%rowtype;
  v_client global.clients%rowtype;
  v_invoice global.invoices%rowtype;
  v_existing global.invoices%rowtype;
  v_items jsonb;
  v_number bigint;
  v_invoice_number text;
  v_total bigint;
  v_fingerprint text;
  v_snapshot jsonb;
begin
  if p_user_id is null or p_workspace_id is null or p_invoice_id is null or p_idempotency_key is null then
    return jsonb_build_object('ok',false,'reason','invalid_request');
  end if;

  select role into v_role from global.workspace_members
  where workspace_id=p_workspace_id and user_id=p_user_id and status='active'
  limit 1;
  if v_role is null then return jsonb_build_object('ok',false,'reason','access_denied'); end if;
  if v_role not in ('owner','admin','manager') then return jsonb_build_object('ok',false,'reason','forbidden'); end if;

  v_fingerprint := md5(jsonb_build_object(
    'document_type','commercial_invoice',
    'workspace_id',p_workspace_id,
    'invoice_id',p_invoice_id
  )::text);
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':commercial-issue:' || p_idempotency_key::text,0));
  select * into v_existing from global.invoices
  where workspace_id=p_workspace_id and issuance_idempotency_key=p_idempotency_key
  for update;
  if found then
    if v_existing.id <> p_invoice_id
      or v_existing.invoice_snapshot->>'issuance_request_fingerprint' is distinct from v_fingerprint then
      return jsonb_build_object('ok',false,'reason','idempotency_conflict');
    end if;
    select coalesce(jsonb_agg(to_jsonb(t) order by t.sort_order),'[]'::jsonb)
      into v_items from global.invoice_items t
      where t.workspace_id=p_workspace_id and t.invoice_id=p_invoice_id;
    return jsonb_build_object('ok',true,'duplicate',true,'invoice',to_jsonb(v_existing),'items',v_items);
  end if;

  select * into v_workspace from global.workspaces where id=p_workspace_id;
  select * into v_profile from global.business_profiles where workspace_id=p_workspace_id;
  select * into v_invoice from global.invoices
  where id=p_invoice_id and workspace_id=p_workspace_id
  for update;
  if v_invoice.id is null then return jsonb_build_object('ok',false,'reason','invoice_not_found'); end if;
  if v_invoice.status <> 'draft' then return jsonb_build_object('ok',false,'reason','invoice_not_draft'); end if;

  if not (
    (v_workspace.country_code='US' and v_workspace.currency_code='USD') or
    (v_workspace.country_code='GB' and v_workspace.currency_code='GBP') or
    (v_workspace.country_code='AE' and v_workspace.currency_code='AED') or
    (v_workspace.country_code='CA' and v_workspace.currency_code='CAD') or
    (v_workspace.country_code='AU' and v_workspace.currency_code='AUD') or
    (v_workspace.country_code='SG' and v_workspace.currency_code='SGD')
  ) then
    return jsonb_build_object('ok',false,'reason','country_not_enabled');
  end if;
  if v_profile.workspace_id is null
    or v_profile.country_code is distinct from v_workspace.country_code
    or v_profile.currency_code is distinct from v_workspace.currency_code
    or nullif(btrim(v_profile.legal_name),'') is null
    or nullif(btrim(v_profile.address),'') is null then
    return jsonb_build_object('ok',false,'reason','seller_profile_incomplete');
  end if;
  if v_invoice.currency_code is distinct from v_workspace.currency_code
    or v_invoice.subtotal_minor is null
    or v_invoice.discount_minor is null
    or v_invoice.subtotal_minor < v_invoice.discount_minor then
    return jsonb_build_object('ok',false,'reason','invalid_invoice_amounts');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,'description',t.description,'quantity',t.quantity,
    'unit_price_minor',t.unit_price_minor,'discount_minor',t.discount_minor,
    'tax_rate_bps',0,'tax_minor',0,'line_total_minor',t.line_total_minor,
    'sort_order',t.sort_order
  ) order by t.sort_order,t.id),'[]'::jsonb)
  into v_items
  from global.invoice_items t
  where t.workspace_id=p_workspace_id and t.invoice_id=p_invoice_id;
  if jsonb_array_length(v_items)=0 then return jsonb_build_object('ok',false,'reason','invalid_invoice_amounts'); end if;

  if v_invoice.client_id is not null then
    select * into v_client from global.clients
    where id=v_invoice.client_id and workspace_id=p_workspace_id;
  end if;

  v_total := v_invoice.subtotal_minor-v_invoice.discount_minor;
  if v_total < 0 or v_total > 9000000000000000 then
    return jsonb_build_object('ok',false,'reason','invoice_total_limit');
  end if;

  insert into global.invoice_number_sequences(workspace_id,invoice_year,last_number)
  values(p_workspace_id,extract(year from v_invoice.issue_date)::integer,1)
  on conflict(workspace_id,invoice_year) do update
    set last_number=global.invoice_number_sequences.last_number+1,updated_at=now()
  returning last_number into v_number;
  v_invoice_number := 'INV-' || v_workspace.country_code || '-' ||
    extract(year from v_invoice.issue_date)::integer::text || '-' || lpad(v_number::text,6,'0');

  v_snapshot := jsonb_build_object(
    'schema_version','1',
    'document_type','commercial_invoice',
    'document_status','issued',
    'issuance_request_fingerprint',v_fingerprint,
    'country_code',v_workspace.country_code,
    'currency_code',v_workspace.currency_code,
    'locale_code',case v_workspace.country_code
      when 'US' then 'en-US' when 'GB' then 'en-GB' when 'AE' then 'en-AE'
      when 'CA' then 'en-CA' when 'AU' then 'en-AU' when 'SG' then 'en-SG' end,
    'invoice_number',v_invoice_number,
    'issue_date',v_invoice.issue_date,
    'due_date',v_invoice.due_date,
    'tax_status','not_assessed',
    'tax_mode','not_assessed',
    'tax_disclosure','Tax has not been calculated or validated by Plivex. The seller is responsible for confirming the applicable tax treatment before using this document for tax reporting.',
    'seller',jsonb_build_object(
      'legal_name',v_profile.legal_name,'display_name',v_profile.display_name,
      'address',v_profile.address,'email',v_profile.email,'phone',v_profile.phone,
      'tax_registration_number',v_profile.tax_registration_number,
      'tax_registration_type',v_profile.tax_registration_type
    ),
    'buyer',case when v_client.id is null then jsonb_build_object('name','Customer') else jsonb_build_object(
      'name',v_client.name,'email',v_client.email,'phone',v_client.phone,
      'tax_registration_number',v_client.tax_registration_number,
      'billing_address',v_client.billing_address,'shipping_address',v_client.shipping_address
    ) end,
    'items',v_items,
    'subtotal_minor',v_invoice.subtotal_minor,
    'discount_minor',v_invoice.discount_minor,
    'tax_minor',0,
    'total_minor',v_total,
    'notes',v_invoice.notes,
    'issued_by',p_user_id,
    'finalized_at',now()
  );

  update global.invoices set
    invoice_number=v_invoice_number,
    status='issued',
    tax_minor=0,
    total_minor=v_total,
    invoice_snapshot=v_snapshot,
    issuance_idempotency_key=p_idempotency_key,
    updated_at=now()
  where id=p_invoice_id and workspace_id=p_workspace_id
  returning * into v_invoice;

  insert into global.audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata)
  values (p_workspace_id,p_user_id,'invoice.commercial_issued','invoice',p_invoice_id::text,
    jsonb_build_object('invoiceNumber',v_invoice_number,'countryCode',v_workspace.country_code,'currencyCode',v_workspace.currency_code,'taxStatus','not_assessed'));

  return jsonb_build_object('ok',true,'duplicate',false,'invoice',to_jsonb(v_invoice),'items',v_items);
end;
$function$;

create or replace function public.global_create_invoice_share(
  p_user_id uuid,
  p_workspace_id uuid,
  p_invoice_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, global
as $function$
declare
  v_role text;
  v_workspace global.workspaces%rowtype;
  v_profile global.business_profiles%rowtype;
  v_client global.clients%rowtype;
  v_invoice global.invoices%rowtype;
  v_items jsonb;
  v_snapshot jsonb;
  v_link global.invoice_share_links%rowtype;
begin
  if p_user_id is null or p_workspace_id is null or p_invoice_id is null
    or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_expires_at is null or p_expires_at <= now()
    or p_expires_at > now()+interval '30 days' then
    return jsonb_build_object('ok',false,'reason','invalid_share_request');
  end if;

  select role into v_role from global.workspace_members
  where workspace_id=p_workspace_id and user_id=p_user_id and status='active'
  limit 1;
  if v_role is null then return jsonb_build_object('ok',false,'reason','access_denied'); end if;
  if v_role not in ('owner','admin','manager','accountant') then return jsonb_build_object('ok',false,'reason','forbidden'); end if;

  select * into v_invoice from global.invoices
  where id=p_invoice_id and workspace_id=p_workspace_id
  for share;
  if v_invoice.id is null then return jsonb_build_object('ok',false,'reason','invoice_not_found'); end if;
  select * into v_workspace from global.workspaces where id=p_workspace_id;
  if v_invoice.currency_code is distinct from v_workspace.currency_code then
    return jsonb_build_object('ok',false,'reason','currency_mismatch');
  end if;
  if v_invoice.status not in ('draft','issued','partially_paid','paid','overdue','partially_refunded','refunded') then
    return jsonb_build_object('ok',false,'reason','invoice_not_shareable');
  end if;
  select * into v_workspace from global.workspaces where id=p_workspace_id;
  select * into v_profile from global.business_profiles where workspace_id=p_workspace_id;
  if v_invoice.client_id is not null then
    select * into v_client from global.clients where id=v_invoice.client_id and workspace_id=p_workspace_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,'description',t.description,'quantity',t.quantity,
    'unit_price_minor',t.unit_price_minor,'discount_minor',t.discount_minor,
    'tax_rate_bps',t.tax_rate_bps,'tax_minor',t.tax_minor,
    'line_total_minor',t.line_total_minor,'sort_order',t.sort_order
  ) order by t.sort_order,t.id),'[]'::jsonb)
  into v_items
  from global.invoice_items t
  where t.workspace_id=p_workspace_id and t.invoice_id=p_invoice_id;

  if v_invoice.status='draft' then
    v_snapshot := jsonb_build_object(
      'document_type','draft_invoice','document_status','draft',
      'country_code',v_workspace.country_code,'currency_code',v_invoice.currency_code,
      'locale_code',case v_workspace.country_code
        when 'IN' then 'en-IN' when 'US' then 'en-US' when 'GB' then 'en-GB'
        when 'AE' then 'en-AE' when 'CA' then 'en-CA' when 'AU' then 'en-AU'
        when 'SG' then 'en-SG' else 'en' end,
      'invoice_number',v_invoice.invoice_number,'issue_date',v_invoice.issue_date,'due_date',v_invoice.due_date,
      'tax_status','not_assessed',
      'tax_disclosure','DRAFT — NOT ISSUED. Tax has not been assessed or validated by Plivex.',
      'seller',jsonb_build_object(
        'legal_name',v_profile.legal_name,'display_name',v_profile.display_name,
        'address',v_profile.address,'email',v_profile.email,'phone',v_profile.phone,
        'tax_registration_number',v_profile.tax_registration_number,
        'tax_registration_type',v_profile.tax_registration_type
      ),
      'buyer',case when v_client.id is null then jsonb_build_object('name','Customer') else jsonb_build_object(
        'name',v_client.name,'tax_registration_number',v_client.tax_registration_number,
        'billing_address',v_client.billing_address,'shipping_address',v_client.shipping_address
      ) end,
      'items',v_items,'subtotal_minor',v_invoice.subtotal_minor,
      'discount_minor',v_invoice.discount_minor,'tax_minor',v_invoice.tax_minor,
      'total_minor',v_invoice.total_minor,'notes',v_invoice.notes
    );
  else
    v_snapshot := coalesce(v_invoice.invoice_snapshot,'{}'::jsonb) || jsonb_build_object(
      'document_status',v_invoice.status,
      'country_code',coalesce(v_invoice.invoice_snapshot->>'country_code',v_workspace.country_code),
      'currency_code',coalesce(v_invoice.invoice_snapshot->>'currency_code',v_invoice.currency_code),
      'locale_code',coalesce(v_invoice.invoice_snapshot->>'locale_code',case v_workspace.country_code
        when 'IN' then 'en-IN' when 'US' then 'en-US' when 'GB' then 'en-GB'
        when 'AE' then 'en-AE' when 'CA' then 'en-CA' when 'AU' then 'en-AU'
        when 'SG' then 'en-SG' else 'en' end),
      'invoice_number',coalesce(v_invoice.invoice_snapshot->>'invoice_number',v_invoice.invoice_number),
      'issue_date',coalesce(v_invoice.invoice_snapshot->'issue_date',to_jsonb(v_invoice.issue_date)),
      'due_date',coalesce(v_invoice.invoice_snapshot->'due_date',to_jsonb(v_invoice.due_date)),
      'items',coalesce(v_invoice.invoice_snapshot->'items',v_items),
      'subtotal_minor',coalesce(v_invoice.invoice_snapshot->'subtotal_minor',to_jsonb(v_invoice.subtotal_minor)),
      'discount_minor',coalesce(v_invoice.invoice_snapshot->'discount_minor',to_jsonb(v_invoice.discount_minor)),
      'tax_minor',coalesce(v_invoice.invoice_snapshot->'tax_minor',to_jsonb(v_invoice.tax_minor)),
      'total_minor',coalesce(v_invoice.invoice_snapshot->'total_minor',to_jsonb(v_invoice.total_minor)),
      'notes',coalesce(v_invoice.invoice_snapshot->'notes',to_jsonb(v_invoice.notes)),
      'seller',coalesce(v_invoice.invoice_snapshot->'seller',jsonb_build_object(
        'legal_name',v_profile.legal_name,'display_name',v_profile.display_name,'address',v_profile.address
      )),
      'buyer',coalesce(v_invoice.invoice_snapshot->'buyer',jsonb_build_object('name',coalesce(v_client.name,'Customer')))
    );
  end if;

  v_snapshot := jsonb_set(v_snapshot,'{buyer}',coalesce(v_snapshot->'buyer','{}'::jsonb)-'email'-'phone',true);
  insert into global.invoice_share_links(workspace_id,invoice_id,token_hash,share_snapshot,expires_at,created_by)
  values(p_workspace_id,p_invoice_id,p_token_hash,v_snapshot,p_expires_at,p_user_id)
  returning * into v_link;

  insert into global.audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_workspace_id,p_user_id,'invoice.share.created','invoice_share_link',v_link.id::text,
    jsonb_build_object('invoiceId',p_invoice_id,'expiresAt',p_expires_at,'documentStatus',v_invoice.status));

  return jsonb_build_object('ok',true,'share_id',v_link.id,'expires_at',v_link.expires_at);
end;
$function$;

create or replace function public.global_revoke_invoice_share(
  p_user_id uuid,
  p_workspace_id uuid,
  p_share_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, global
as $function$
declare
  v_role text;
  v_link global.invoice_share_links%rowtype;
begin
  if p_user_id is null or p_workspace_id is null or p_share_id is null then
    return jsonb_build_object('ok',false,'reason','invalid_share_request');
  end if;
  select role into v_role from global.workspace_members
  where workspace_id=p_workspace_id and user_id=p_user_id and status='active'
  limit 1;
  if v_role is null then return jsonb_build_object('ok',false,'reason','access_denied'); end if;
  if v_role not in ('owner','admin','manager','accountant') then return jsonb_build_object('ok',false,'reason','forbidden'); end if;

  update global.invoice_share_links set revoked_at=coalesce(revoked_at,now())
  where id=p_share_id and workspace_id=p_workspace_id
  returning * into v_link;
  if v_link.id is null then return jsonb_build_object('ok',false,'reason','share_not_found'); end if;

  insert into global.audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_workspace_id,p_user_id,'invoice.share.revoked','invoice_share_link',v_link.id::text,
    jsonb_build_object('invoiceId',v_link.invoice_id));
  return jsonb_build_object('ok',true,'share_id',v_link.id,'revoked_at',v_link.revoked_at);
end;
$function$;

-- Public resolution exposes only a frozen invoice document snapshot, never raw
-- workspace tables or the bearer token. The token is hashed before it reaches SQL.
create or replace function public.global_check_invoice_share_rate_limit(p_key_hash text,p_limit integer default 60,p_window_seconds integer default 3600)
returns jsonb language plpgsql security definer set search_path=pg_catalog,global as $function$
declare v_window timestamptz; v_count integer;
begin
 if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' or p_limit is null or p_limit<1 or p_limit>1000
 or p_window_seconds is null or p_window_seconds<30 or p_window_seconds>86400 then
 return jsonb_build_object('ok',false,'reason','invalid_rate_limit_request'); end if;
 insert into global.invoice_share_rate_limits as limits(key_hash,window_started_at,request_count,updated_at) values(p_key_hash,now(),1,now())
 on conflict(key_hash) do update set
 window_started_at=case when limits.window_started_at<=now()-make_interval(secs=>p_window_seconds) then now() else limits.window_started_at end,
 request_count=case when limits.window_started_at<=now()-make_interval(secs=>p_window_seconds) then 1 else limits.request_count+1 end,
 updated_at=now()
 returning window_started_at,request_count into v_window,v_count;
 if v_count%100=0 then delete from global.invoice_share_rate_limits where updated_at<now()-interval '48 hours'; end if;
 return jsonb_build_object('ok',true,'allowed',v_count<=p_limit,'remaining',greatest(0,p_limit-v_count),
 'reset_at',v_window+make_interval(secs=>p_window_seconds));
end;
$function$;

create or replace function public.global_resolve_invoice_share(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, global
as $function$
declare
  v_link global.invoice_share_links%rowtype;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok',false,'reason','invalid_or_expired');
  end if;
  select * into v_link from global.invoice_share_links
  where token_hash=p_token_hash and revoked_at is null and expires_at>now()
  for update;
  if v_link.id is null then return jsonb_build_object('ok',false,'reason','invalid_or_expired'); end if;

  update global.invoice_share_links
  set last_accessed_at=now(),access_count=access_count+1
  where id=v_link.id;

  return jsonb_build_object('ok',true,'snapshot',v_link.share_snapshot,'expires_at',v_link.expires_at);
end;
$function$;

revoke all on function public.global_issue_commercial_invoice(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.global_create_invoice_share(uuid,uuid,uuid,text,timestamptz) from public,anon,authenticated;
revoke all on function public.global_revoke_invoice_share(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.global_resolve_invoice_share(text) from public,anon,authenticated;
revoke all on function public.global_check_invoice_share_rate_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.global_issue_commercial_invoice(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.global_create_invoice_share(uuid,uuid,uuid,text,timestamptz) to service_role;
grant execute on function public.global_revoke_invoice_share(uuid,uuid,uuid) to service_role;
grant execute on function public.global_resolve_invoice_share(text) to service_role;
grant execute on function public.global_check_invoice_share_rate_limit(text,integer,integer) to service_role;

comment on table global.invoice_share_links is 'Hashed bearer-token links to immutable Global invoice snapshots with expiry, revocation and access audit.';
comment on function public.global_issue_commercial_invoice(uuid,uuid,uuid,uuid) is 'Issues a Global commercial invoice in the workspace base currency without asserting tax calculation or tax compliance.';

commit;
),
 window_started_at timestamptz not null,
 request_count integer not null default 0 check(request_count>=0),
 updated_at timestamptz not null default now()
);
create index if not exists global_invoice_share_rate_limits_updated_idx on global.invoice_share_rate_limits(updated_at);
alter table global.invoice_share_rate_limits enable row level security;
revoke all on global.invoice_share_rate_limits from public,anon,authenticated;
grant all on global.invoice_share_rate_limits to service_role;

-- Commercial invoices are a document workflow, not a claim of tax calculation.
-- This RPC is available for the six non-India Global workspaces with their exact
-- registered base currency. The UK VAT tax-invoice RPC remains a separate path.
create or replace function public.global_issue_commercial_invoice(
  p_user_id uuid,
  p_workspace_id uuid,
  p_invoice_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, global
as $function$
declare
  v_role text;
  v_workspace global.workspaces%rowtype;
  v_profile global.business_profiles%rowtype;
  v_client global.clients%rowtype;
  v_invoice global.invoices%rowtype;
  v_existing global.invoices%rowtype;
  v_items jsonb;
  v_number bigint;
  v_invoice_number text;
  v_total bigint;
  v_fingerprint text;
  v_snapshot jsonb;
begin
  if p_user_id is null or p_workspace_id is null or p_invoice_id is null or p_idempotency_key is null then
    return jsonb_build_object('ok',false,'reason','invalid_request');
  end if;

  select role into v_role from global.workspace_members
  where workspace_id=p_workspace_id and user_id=p_user_id and status='active'
  limit 1;
  if v_role is null then return jsonb_build_object('ok',false,'reason','access_denied'); end if;
  if v_role not in ('owner','admin','manager') then return jsonb_build_object('ok',false,'reason','forbidden'); end if;

  v_fingerprint := md5(jsonb_build_object(
    'document_type','commercial_invoice',
    'workspace_id',p_workspace_id,
    'invoice_id',p_invoice_id
  )::text);
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':commercial-issue:' || p_idempotency_key::text,0));
  select * into v_existing from global.invoices
  where workspace_id=p_workspace_id and issuance_idempotency_key=p_idempotency_key
  for update;
  if found then
    if v_existing.id <> p_invoice_id
      or v_existing.invoice_snapshot->>'issuance_request_fingerprint' is distinct from v_fingerprint then
      return jsonb_build_object('ok',false,'reason','idempotency_conflict');
    end if;
    select coalesce(jsonb_agg(to_jsonb(t) order by t.sort_order),'[]'::jsonb)
      into v_items from global.invoice_items t
      where t.workspace_id=p_workspace_id and t.invoice_id=p_invoice_id;
    return jsonb_build_object('ok',true,'duplicate',true,'invoice',to_jsonb(v_existing),'items',v_items);
  end if;

  select * into v_workspace from global.workspaces where id=p_workspace_id;
  select * into v_profile from global.business_profiles where workspace_id=p_workspace_id;
  select * into v_invoice from global.invoices
  where id=p_invoice_id and workspace_id=p_workspace_id
  for update;
  if v_invoice.id is null then return jsonb_build_object('ok',false,'reason','invoice_not_found'); end if;
  if v_invoice.status <> 'draft' then return jsonb_build_object('ok',false,'reason','invoice_not_draft'); end if;

  if not (
    (v_workspace.country_code='US' and v_workspace.currency_code='USD') or
    (v_workspace.country_code='GB' and v_workspace.currency_code='GBP') or
    (v_workspace.country_code='AE' and v_workspace.currency_code='AED') or
    (v_workspace.country_code='CA' and v_workspace.currency_code='CAD') or
    (v_workspace.country_code='AU' and v_workspace.currency_code='AUD') or
    (v_workspace.country_code='SG' and v_workspace.currency_code='SGD')
  ) then
    return jsonb_build_object('ok',false,'reason','country_not_enabled');
  end if;
  if v_profile.workspace_id is null
    or v_profile.country_code is distinct from v_workspace.country_code
    or v_profile.currency_code is distinct from v_workspace.currency_code
    or nullif(btrim(v_profile.legal_name),'') is null
    or nullif(btrim(v_profile.address),'') is null then
    return jsonb_build_object('ok',false,'reason','seller_profile_incomplete');
  end if;
  if v_invoice.currency_code is distinct from v_workspace.currency_code
    or v_invoice.subtotal_minor is null
    or v_invoice.discount_minor is null
    or v_invoice.subtotal_minor < v_invoice.discount_minor then
    return jsonb_build_object('ok',false,'reason','invalid_invoice_amounts');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,'description',t.description,'quantity',t.quantity,
    'unit_price_minor',t.unit_price_minor,'discount_minor',t.discount_minor,
    'tax_rate_bps',0,'tax_minor',0,'line_total_minor',t.line_total_minor,
    'sort_order',t.sort_order
  ) order by t.sort_order,t.id),'[]'::jsonb)
  into v_items
  from global.invoice_items t
  where t.workspace_id=p_workspace_id and t.invoice_id=p_invoice_id;
  if jsonb_array_length(v_items)=0 then return jsonb_build_object('ok',false,'reason','invalid_invoice_amounts'); end if;

  if v_invoice.client_id is not null then
    select * into v_client from global.clients
    where id=v_invoice.client_id and workspace_id=p_workspace_id;
  end if;

  v_total := v_invoice.subtotal_minor-v_invoice.discount_minor;
  if v_total < 0 or v_total > 9000000000000000 then
    return jsonb_build_object('ok',false,'reason','invoice_total_limit');
  end if;

  insert into global.invoice_number_sequences(workspace_id,invoice_year,last_number)
  values(p_workspace_id,extract(year from v_invoice.issue_date)::integer,1)
  on conflict(workspace_id,invoice_year) do update
    set last_number=global.invoice_number_sequences.last_number+1,updated_at=now()
  returning last_number into v_number;
  v_invoice_number := 'INV-' || v_workspace.country_code || '-' ||
    extract(year from v_invoice.issue_date)::integer::text || '-' || lpad(v_number::text,6,'0');

  v_snapshot := jsonb_build_object(
    'schema_version','1',
    'document_type','commercial_invoice',
    'document_status','issued',
    'issuance_request_fingerprint',v_fingerprint,
    'country_code',v_workspace.country_code,
    'currency_code',v_workspace.currency_code,
    'locale_code',case v_workspace.country_code
      when 'US' then 'en-US' when 'GB' then 'en-GB' when 'AE' then 'en-AE'
      when 'CA' then 'en-CA' when 'AU' then 'en-AU' when 'SG' then 'en-SG' end,
    'invoice_number',v_invoice_number,
    'issue_date',v_invoice.issue_date,
    'due_date',v_invoice.due_date,
    'tax_status','not_assessed',
    'tax_mode','not_assessed',
    'tax_disclosure','Tax has not been calculated or validated by Plivex. The seller is responsible for confirming the applicable tax treatment before using this document for tax reporting.',
    'seller',jsonb_build_object(
      'legal_name',v_profile.legal_name,'display_name',v_profile.display_name,
      'address',v_profile.address,'email',v_profile.email,'phone',v_profile.phone,
      'tax_registration_number',v_profile.tax_registration_number,
      'tax_registration_type',v_profile.tax_registration_type
    ),
    'buyer',case when v_client.id is null then jsonb_build_object('name','Customer') else jsonb_build_object(
      'name',v_client.name,'email',v_client.email,'phone',v_client.phone,
      'tax_registration_number',v_client.tax_registration_number,
      'billing_address',v_client.billing_address,'shipping_address',v_client.shipping_address
    ) end,
    'items',v_items,
    'subtotal_minor',v_invoice.subtotal_minor,
    'discount_minor',v_invoice.discount_minor,
    'tax_minor',0,
    'total_minor',v_total,
    'notes',v_invoice.notes,
    'issued_by',p_user_id,
    'finalized_at',now()
  );

  update global.invoices set
    invoice_number=v_invoice_number,
    status='issued',
    tax_minor=0,
    total_minor=v_total,
    invoice_snapshot=v_snapshot,
    issuance_idempotency_key=p_idempotency_key,
    updated_at=now()
  where id=p_invoice_id and workspace_id=p_workspace_id
  returning * into v_invoice;

  insert into global.audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata)
  values (p_workspace_id,p_user_id,'invoice.commercial_issued','invoice',p_invoice_id::text,
    jsonb_build_object('invoiceNumber',v_invoice_number,'countryCode',v_workspace.country_code,'currencyCode',v_workspace.currency_code,'taxStatus','not_assessed'));

  return jsonb_build_object('ok',true,'duplicate',false,'invoice',to_jsonb(v_invoice),'items',v_items);
end;
$function$;

create or replace function public.global_create_invoice_share(
  p_user_id uuid,
  p_workspace_id uuid,
  p_invoice_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, global
as $function$
declare
  v_role text;
  v_workspace global.workspaces%rowtype;
  v_profile global.business_profiles%rowtype;
  v_client global.clients%rowtype;
  v_invoice global.invoices%rowtype;
  v_items jsonb;
  v_snapshot jsonb;
  v_link global.invoice_share_links%rowtype;
begin
  if p_user_id is null or p_workspace_id is null or p_invoice_id is null
    or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_expires_at is null or p_expires_at <= now()
    or p_expires_at > now()+interval '30 days' then
    return jsonb_build_object('ok',false,'reason','invalid_share_request');
  end if;

  select role into v_role from global.workspace_members
  where workspace_id=p_workspace_id and user_id=p_user_id and status='active'
  limit 1;
  if v_role is null then return jsonb_build_object('ok',false,'reason','access_denied'); end if;
  if v_role not in ('owner','admin','manager','accountant') then return jsonb_build_object('ok',false,'reason','forbidden'); end if;

  select * into v_invoice from global.invoices
  where id=p_invoice_id and workspace_id=p_workspace_id
  for share;
  if v_invoice.id is null then return jsonb_build_object('ok',false,'reason','invoice_not_found'); end if;
  select * into v_workspace from global.workspaces where id=p_workspace_id;
  if v_invoice.currency_code is distinct from v_workspace.currency_code then
    return jsonb_build_object('ok',false,'reason','currency_mismatch');
  end if;
  if v_invoice.status not in ('draft','issued','partially_paid','paid','overdue','partially_refunded','refunded') then
    return jsonb_build_object('ok',false,'reason','invoice_not_shareable');
  end if;
  select * into v_workspace from global.workspaces where id=p_workspace_id;
  select * into v_profile from global.business_profiles where workspace_id=p_workspace_id;
  if v_invoice.client_id is not null then
    select * into v_client from global.clients where id=v_invoice.client_id and workspace_id=p_workspace_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,'description',t.description,'quantity',t.quantity,
    'unit_price_minor',t.unit_price_minor,'discount_minor',t.discount_minor,
    'tax_rate_bps',t.tax_rate_bps,'tax_minor',t.tax_minor,
    'line_total_minor',t.line_total_minor,'sort_order',t.sort_order
  ) order by t.sort_order,t.id),'[]'::jsonb)
  into v_items
  from global.invoice_items t
  where t.workspace_id=p_workspace_id and t.invoice_id=p_invoice_id;

  if v_invoice.status='draft' then
    v_snapshot := jsonb_build_object(
      'document_type','draft_invoice','document_status','draft',
      'country_code',v_workspace.country_code,'currency_code',v_invoice.currency_code,
      'locale_code',case v_workspace.country_code
        when 'IN' then 'en-IN' when 'US' then 'en-US' when 'GB' then 'en-GB'
        when 'AE' then 'en-AE' when 'CA' then 'en-CA' when 'AU' then 'en-AU'
        when 'SG' then 'en-SG' else 'en' end,
      'invoice_number',v_invoice.invoice_number,'issue_date',v_invoice.issue_date,'due_date',v_invoice.due_date,
      'tax_status','not_assessed',
      'tax_disclosure','DRAFT — NOT ISSUED. Tax has not been assessed or validated by Plivex.',
      'seller',jsonb_build_object(
        'legal_name',v_profile.legal_name,'display_name',v_profile.display_name,
        'address',v_profile.address,'email',v_profile.email,'phone',v_profile.phone,
        'tax_registration_number',v_profile.tax_registration_number,
        'tax_registration_type',v_profile.tax_registration_type
      ),
      'buyer',case when v_client.id is null then jsonb_build_object('name','Customer') else jsonb_build_object(
        'name',v_client.name,'tax_registration_number',v_client.tax_registration_number,
        'billing_address',v_client.billing_address,'shipping_address',v_client.shipping_address
      ) end,
      'items',v_items,'subtotal_minor',v_invoice.subtotal_minor,
      'discount_minor',v_invoice.discount_minor,'tax_minor',v_invoice.tax_minor,
      'total_minor',v_invoice.total_minor,'notes',v_invoice.notes
    );
  else
    v_snapshot := coalesce(v_invoice.invoice_snapshot,'{}'::jsonb) || jsonb_build_object(
      'document_status',v_invoice.status,
      'country_code',coalesce(v_invoice.invoice_snapshot->>'country_code',v_workspace.country_code),
      'currency_code',coalesce(v_invoice.invoice_snapshot->>'currency_code',v_invoice.currency_code),
      'locale_code',coalesce(v_invoice.invoice_snapshot->>'locale_code',case v_workspace.country_code
        when 'IN' then 'en-IN' when 'US' then 'en-US' when 'GB' then 'en-GB'
        when 'AE' then 'en-AE' when 'CA' then 'en-CA' when 'AU' then 'en-AU'
        when 'SG' then 'en-SG' else 'en' end),
      'invoice_number',coalesce(v_invoice.invoice_snapshot->>'invoice_number',v_invoice.invoice_number),
      'issue_date',coalesce(v_invoice.invoice_snapshot->'issue_date',to_jsonb(v_invoice.issue_date)),
      'due_date',coalesce(v_invoice.invoice_snapshot->'due_date',to_jsonb(v_invoice.due_date)),
      'items',coalesce(v_invoice.invoice_snapshot->'items',v_items),
      'subtotal_minor',coalesce(v_invoice.invoice_snapshot->'subtotal_minor',to_jsonb(v_invoice.subtotal_minor)),
      'discount_minor',coalesce(v_invoice.invoice_snapshot->'discount_minor',to_jsonb(v_invoice.discount_minor)),
      'tax_minor',coalesce(v_invoice.invoice_snapshot->'tax_minor',to_jsonb(v_invoice.tax_minor)),
      'total_minor',coalesce(v_invoice.invoice_snapshot->'total_minor',to_jsonb(v_invoice.total_minor)),
      'notes',coalesce(v_invoice.invoice_snapshot->'notes',to_jsonb(v_invoice.notes)),
      'seller',coalesce(v_invoice.invoice_snapshot->'seller',jsonb_build_object(
        'legal_name',v_profile.legal_name,'display_name',v_profile.display_name,'address',v_profile.address
      )),
      'buyer',coalesce(v_invoice.invoice_snapshot->'buyer',jsonb_build_object('name',coalesce(v_client.name,'Customer')))
    );
  end if;

  v_snapshot := jsonb_set(v_snapshot,'{buyer}',coalesce(v_snapshot->'buyer','{}'::jsonb)-'email'-'phone',true);
  insert into global.invoice_share_links(workspace_id,invoice_id,token_hash,share_snapshot,expires_at,created_by)
  values(p_workspace_id,p_invoice_id,p_token_hash,v_snapshot,p_expires_at,p_user_id)
  returning * into v_link;

  insert into global.audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_workspace_id,p_user_id,'invoice.share.created','invoice_share_link',v_link.id::text,
    jsonb_build_object('invoiceId',p_invoice_id,'expiresAt',p_expires_at,'documentStatus',v_invoice.status));

  return jsonb_build_object('ok',true,'share_id',v_link.id,'expires_at',v_link.expires_at);
end;
$function$;

create or replace function public.global_revoke_invoice_share(
  p_user_id uuid,
  p_workspace_id uuid,
  p_share_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, global
as $function$
declare
  v_role text;
  v_link global.invoice_share_links%rowtype;
begin
  if p_user_id is null or p_workspace_id is null or p_share_id is null then
    return jsonb_build_object('ok',false,'reason','invalid_share_request');
  end if;
  select role into v_role from global.workspace_members
  where workspace_id=p_workspace_id and user_id=p_user_id and status='active'
  limit 1;
  if v_role is null then return jsonb_build_object('ok',false,'reason','access_denied'); end if;
  if v_role not in ('owner','admin','manager','accountant') then return jsonb_build_object('ok',false,'reason','forbidden'); end if;

  update global.invoice_share_links set revoked_at=coalesce(revoked_at,now())
  where id=p_share_id and workspace_id=p_workspace_id
  returning * into v_link;
  if v_link.id is null then return jsonb_build_object('ok',false,'reason','share_not_found'); end if;

  insert into global.audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_workspace_id,p_user_id,'invoice.share.revoked','invoice_share_link',v_link.id::text,
    jsonb_build_object('invoiceId',v_link.invoice_id));
  return jsonb_build_object('ok',true,'share_id',v_link.id,'revoked_at',v_link.revoked_at);
end;
$function$;

-- Public resolution exposes only a frozen invoice document snapshot, never raw
-- workspace tables or the bearer token. The token is hashed before it reaches SQL.
create or replace function public.global_check_invoice_share_rate_limit(p_key_hash text,p_limit integer default 60,p_window_seconds integer default 3600)
returns jsonb language plpgsql security definer set search_path=pg_catalog,global as $function$
declare v_window timestamptz; v_count integer;
begin
 if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' or p_limit is null or p_limit<1 or p_limit>1000
 or p_window_seconds is null or p_window_seconds<30 or p_window_seconds>86400 then
 return jsonb_build_object('ok',false,'reason','invalid_rate_limit_request'); end if;
 insert into global.invoice_share_rate_limits as limits(key_hash,window_started_at,request_count,updated_at) values(p_key_hash,now(),1,now())
 on conflict(key_hash) do update set
 window_started_at=case when limits.window_started_at<=now()-make_interval(secs=>p_window_seconds) then now() else limits.window_started_at end,
 request_count=case when limits.window_started_at<=now()-make_interval(secs=>p_window_seconds) then 1 else limits.request_count+1 end,
 updated_at=now()
 returning window_started_at,request_count into v_window,v_count;
 if v_count%100=0 then delete from global.invoice_share_rate_limits where updated_at<now()-interval '48 hours'; end if;
 return jsonb_build_object('ok',true,'allowed',v_count<=p_limit,'remaining',greatest(0,p_limit-v_count),
 'reset_at',v_window+make_interval(secs=>p_window_seconds));
end;
$function$;

create or replace function public.global_resolve_invoice_share(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, global
as $function$
declare
  v_link global.invoice_share_links%rowtype;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok',false,'reason','invalid_or_expired');
  end if;
  select * into v_link from global.invoice_share_links
  where token_hash=p_token_hash and revoked_at is null and expires_at>now()
  for update;
  if v_link.id is null then return jsonb_build_object('ok',false,'reason','invalid_or_expired'); end if;

  update global.invoice_share_links
  set last_accessed_at=now(),access_count=access_count+1
  where id=v_link.id;

  return jsonb_build_object('ok',true,'snapshot',v_link.share_snapshot,'expires_at',v_link.expires_at);
end;
$function$;

revoke all on function public.global_issue_commercial_invoice(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.global_create_invoice_share(uuid,uuid,uuid,text,timestamptz) from public,anon,authenticated;
revoke all on function public.global_revoke_invoice_share(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.global_resolve_invoice_share(text) from public,anon,authenticated;
revoke all on function public.global_check_invoice_share_rate_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.global_issue_commercial_invoice(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.global_create_invoice_share(uuid,uuid,uuid,text,timestamptz) to service_role;
grant execute on function public.global_revoke_invoice_share(uuid,uuid,uuid) to service_role;
grant execute on function public.global_resolve_invoice_share(text) to service_role;
grant execute on function public.global_check_invoice_share_rate_limit(text,integer,integer) to service_role;

comment on table global.invoice_share_links is 'Hashed bearer-token links to immutable Global invoice snapshots with expiry, revocation and access audit.';
comment on function public.global_issue_commercial_invoice(uuid,uuid,uuid,uuid) is 'Issues a Global commercial invoice in the workspace base currency without asserting tax calculation or tax compliance.';

commit;
