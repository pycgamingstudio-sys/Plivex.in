-- Immutable document snapshots with one-time link-based electronic acknowledgement.
begin;

create table if not exists global.document_signature_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references global.workspaces(id) on delete cascade,
  document_type text not null check (document_type in ('invoice','quotation')),
  document_id uuid not null,
  document_number text not null check (length(btrim(document_number)) between 1 and 80),
  document_snapshot jsonb not null check (jsonb_typeof(document_snapshot)='object'),
  document_hash text not null check (document_hash ~ '^[a-f0-9]{64}$'),
  signer_name text not null check (length(btrim(signer_name)) between 1 and 160),
  signer_email text not null check (signer_email ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$' and length(signer_email)<=254),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  consent_text text not null check (length(consent_text) between 20 and 1000),
  status text not null default 'pending' check (status in ('pending','signed','revoked')),
  expires_at timestamptz not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  signed_name text check (signed_name is null or length(btrim(signed_name)) between 1 and 160),
  signed_at timestamptz,
  signature_hash text check (signature_hash is null or signature_hash ~ '^[a-f0-9]{64}$'),
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  check (expires_at>created_at and expires_at<=created_at+interval '7 days'),
  check ((status<>'signed') or (signed_name is not null and signed_at is not null and signature_hash is not null)),
  check ((status<>'revoked') or (revoked_by is not null and revoked_at is not null))
);
create index if not exists global_document_signatures_workspace_idx
  on global.document_signature_requests(workspace_id,created_at desc);
create index if not exists global_document_signatures_pending_idx
  on global.document_signature_requests(workspace_id,expires_at) where status='pending';

alter table global.document_signature_requests enable row level security;
revoke all on global.document_signature_requests from public,anon,authenticated;
grant all on global.document_signature_requests to service_role;

create or replace function global.prevent_document_signature_snapshot_mutation()
returns trigger language plpgsql set search_path=pg_catalog,global
as $$
begin
  if new.workspace_id is distinct from old.workspace_id
    or new.document_type is distinct from old.document_type
    or new.document_id is distinct from old.document_id
    or new.document_number is distinct from old.document_number
    or new.document_snapshot is distinct from old.document_snapshot
    or new.document_hash is distinct from old.document_hash
    or new.signer_name is distinct from old.signer_name
    or new.signer_email is distinct from old.signer_email
    or new.token_hash is distinct from old.token_hash
    or new.consent_text is distinct from old.consent_text
    or new.expires_at is distinct from old.expires_at
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception 'Document signature snapshot is immutable';
  end if;
  if old.signature_hash is not null and (
    new.signature_hash is distinct from old.signature_hash
    or new.signed_name is distinct from old.signed_name
    or new.signed_at is distinct from old.signed_at
  ) then
    raise exception 'Signed acknowledgement is immutable';
  end if;
  return new;
end $$;
drop trigger if exists global_document_signature_snapshot_immutable on global.document_signature_requests;
create trigger global_document_signature_snapshot_immutable
before update on global.document_signature_requests
for each row execute function global.prevent_document_signature_snapshot_mutation();

create or replace function public.global_document_signature_create(
  p_user_id uuid,p_workspace_id uuid,p_document_type text,p_document_id uuid,
  p_signer_name text,p_signer_email text,p_token_hash text,p_expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path=pg_catalog,global
as $$
declare v_member global.workspace_members%rowtype; v_snapshot jsonb; v_number text;
  v_hash text; v_consent text:='I confirm I reviewed the document snapshot shown here and agree to record my electronic acknowledgement using the name entered below.';
  v_id uuid; v_status text;
begin
  select * into v_member from global.workspace_members
    where workspace_id=p_workspace_id and user_id=p_user_id and status='active' limit 1;
  if v_member.id is null then return jsonb_build_object('ok',false,'code','ACCESS_DENIED'); end if;
  if v_member.role not in ('owner','admin','manager','accountant') then
    return jsonb_build_object('ok',false,'code','PERMISSION_DENIED');
  end if;
  if p_document_type is null or p_document_type not in ('invoice','quotation') or p_document_id is null
    or p_signer_name is null or length(btrim(p_signer_name)) not between 1 and 160
    or p_signer_email is null or length(p_signer_email)>254
    or p_signer_email !~* '^[^\s@]+@[^\s@]+\.[^\s@]+$'
    or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$'
    or p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '7 days' then
    return jsonb_build_object('ok',false,'code','INVALID_SIGNATURE_REQUEST');
  end if;
  if p_document_type='invoice' then
    select jsonb_build_object(
      'documentType','invoice','documentNumber',i.invoice_number,'documentStatus',i.status,
      'currencyCode',i.currency_code,'issueDate',i.issue_date,'dueDate',i.due_date,
      'subtotalMinor',i.subtotal_minor,'discountMinor',i.discount_minor,'taxMinor',i.tax_minor,
      'totalMinor',i.total_minor,'notes',i.notes,
      'issuer',jsonb_build_object('name',coalesce(nullif(bp.display_name,''),bp.legal_name),'legalName',bp.legal_name,
        'email',bp.email,'address',bp.address,'countryCode',bp.country_code),
      'client',case when c.id is null then '{}'::jsonb else jsonb_build_object('name',c.name,'email',c.email,'billingAddress',c.billing_address) end,
      'items',case when jsonb_typeof(i.invoice_snapshot->'items')='array' then i.invoice_snapshot->'items' else '[]'::jsonb end,
      'invoiceSnapshot',i.invoice_snapshot
    ),i.invoice_number,i.status
    into v_snapshot,v_number,v_status
    from global.invoices i
    left join global.clients c on c.workspace_id=i.workspace_id and c.id=i.client_id
    left join global.business_profiles bp on bp.workspace_id=i.workspace_id
    where i.workspace_id=p_workspace_id and i.id=p_document_id;
    if v_snapshot is null then return jsonb_build_object('ok',false,'code','DOCUMENT_NOT_FOUND'); end if;
    if v_status not in ('issued','partially_paid','paid','overdue','partially_refunded','refunded') then
      return jsonb_build_object('ok',false,'code','DOCUMENT_NOT_SIGNABLE');
    end if;
  else
    select jsonb_build_object(
      'documentType','quotation','documentNumber',q.quotation_number,'documentStatus',q.status,
      'currencyCode',q.currency_code,'issueDate',q.issue_date,'validUntil',q.valid_until,
      'subtotalMinor',q.subtotal_minor,'discountMinor',q.discount_minor,'taxMinor',q.tax_minor,
      'totalMinor',coalesce(q.total_including_tax_minor,q.total_minor+q.tax_minor),'notes',q.notes,
      'taxSnapshot',q.tax_snapshot,
      'issuer',jsonb_build_object('name',coalesce(nullif(bp.display_name,''),bp.legal_name),'legalName',bp.legal_name,
        'email',bp.email,'address',bp.address,'countryCode',bp.country_code),
      'client',case when c.id is null then '{}'::jsonb else jsonb_build_object('name',c.name,'email',c.email,'billingAddress',c.billing_address) end,
      'items',coalesce((select jsonb_agg(jsonb_build_object('description',qi.description,'quantity',qi.quantity,
        'unitPriceMinor',qi.unit_price_minor,'discountMinor',qi.discount_minor,'lineTotalMinor',qi.line_total_minor)
        order by qi.sort_order) from global.quotation_items qi
        where qi.workspace_id=q.workspace_id and qi.quotation_id=q.id),'[]'::jsonb)
    ),q.quotation_number,q.status
    into v_snapshot,v_number,v_status
    from global.quotations q
    left join global.clients c on c.workspace_id=q.workspace_id and c.id=q.client_id
    left join global.business_profiles bp on bp.workspace_id=q.workspace_id
    where q.workspace_id=p_workspace_id and q.id=p_document_id;
    if v_snapshot is null then return jsonb_build_object('ok',false,'code','DOCUMENT_NOT_FOUND'); end if;
    if v_status<>'sent' then return jsonb_build_object('ok',false,'code','DOCUMENT_NOT_SIGNABLE'); end if;
  end if;
  v_hash:=encode(extensions.digest(convert_to(v_snapshot::text,'UTF8'),'sha256'),'hex');
  insert into global.document_signature_requests(
    workspace_id,document_type,document_id,document_number,document_snapshot,document_hash,
    signer_name,signer_email,token_hash,consent_text,expires_at,created_by
  ) values (
    p_workspace_id,p_document_type,p_document_id,v_number,v_snapshot,v_hash,
    btrim(p_signer_name),lower(btrim(p_signer_email)),p_token_hash,v_consent,p_expires_at,p_user_id
  ) returning id into v_id;
  insert into global.audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata,occurred_at)
  values(p_workspace_id,p_user_id,'document.signature.requested','document_signature',v_id::text,
    jsonb_build_object('document_type',p_document_type,'document_number',v_number,'signer_email',lower(btrim(p_signer_email)),
      'document_hash',v_hash,'expires_at',p_expires_at),now());
  return jsonb_build_object('ok',true,'requestId',v_id,'documentNumber',v_number,'documentHash',v_hash,'expiresAt',p_expires_at);
end $$;

create or replace function public.global_document_signature_list(p_user_id uuid,p_workspace_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,global
as $$
declare v_member global.workspace_members%rowtype; v_requests jsonb; v_documents jsonb;
begin
  select * into v_member from global.workspace_members
    where workspace_id=p_workspace_id and user_id=p_user_id and status='active' limit 1;
  if v_member.id is null then return jsonb_build_object('ok',false,'code','ACCESS_DENIED'); end if;
  if v_member.role not in ('owner','admin','manager','accountant') then
    return jsonb_build_object('ok',false,'code','PERMISSION_DENIED');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'document_type',r.document_type,'document_id',r.document_id,'document_number',r.document_number,
    'signer_name',r.signer_name,'signer_email',r.signer_email,
    'status',case when r.status='pending' and r.expires_at<=now() then 'expired' else r.status end,
    'expires_at',r.expires_at,'created_at',r.created_at,'signed_name',r.signed_name,'signed_at',r.signed_at,
    'document_hash',r.document_hash,'signature_hash',r.signature_hash
  ) order by r.created_at desc),'[]'::jsonb) into v_requests
  from global.document_signature_requests r where r.workspace_id=p_workspace_id;
  select coalesce(jsonb_agg(x.document order by x.created_at desc),'[]'::jsonb) into v_documents
  from (
    select jsonb_build_object('documentType','invoice','documentId',i.id,'documentNumber',i.invoice_number,
      'clientName',c.name,'totalMinor',i.total_minor,'currencyCode',i.currency_code,'status',i.status) as document,
      i.created_at
    from global.invoices i left join global.clients c on c.workspace_id=i.workspace_id and c.id=i.client_id
    where i.workspace_id=p_workspace_id and i.status in ('issued','partially_paid','paid','overdue','partially_refunded','refunded')
    union all
    select jsonb_build_object('documentType','quotation','documentId',q.id,'documentNumber',q.quotation_number,
      'clientName',c.name,'totalMinor',coalesce(q.total_including_tax_minor,q.total_minor+q.tax_minor),
      'currencyCode',q.currency_code,'status',q.status) as document,
      q.created_at
    from global.quotations q left join global.clients c on c.workspace_id=q.workspace_id and c.id=q.client_id
    where q.workspace_id=p_workspace_id and q.status='sent'
  ) x;
  return jsonb_build_object('ok',true,'requests',v_requests,'documents',v_documents);
end $$;

create or replace function public.global_document_signature_read(p_token_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,global
as $$
declare v_request global.document_signature_requests%rowtype;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok',false,'code','INVALID_TOKEN');
  end if;
  select * into v_request from global.document_signature_requests
    where token_hash=p_token_hash and status='pending' and expires_at>now() limit 1;
  if v_request.id is null then return jsonb_build_object('ok',false,'code','SIGNATURE_LINK_UNAVAILABLE'); end if;
  return jsonb_build_object('ok',true,'requestId',v_request.id,'documentType',v_request.document_type,
    'documentNumber',v_request.document_number,'documentSnapshot',v_request.document_snapshot,
    'documentHash',v_request.document_hash,'signerName',v_request.signer_name,
    'consentText',v_request.consent_text,'expiresAt',v_request.expires_at);
end $$;

create or replace function public.global_document_signature_sign(
  p_token_hash text,p_signed_name text,p_consent boolean
) returns jsonb language plpgsql security definer set search_path=pg_catalog,global
as $$
declare v_request global.document_signature_requests%rowtype; v_signed_at timestamptz; v_hash text;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$'
    or p_signed_name is null or length(btrim(p_signed_name)) not between 1 and 160
    or p_consent is distinct from true then
    return jsonb_build_object('ok',false,'code','INVALID_SIGNATURE');
  end if;
  select * into v_request from global.document_signature_requests
    where token_hash=p_token_hash for update;
  if v_request.id is null or v_request.status<>'pending' or v_request.expires_at<=now() then
    return jsonb_build_object('ok',false,'code','SIGNATURE_LINK_UNAVAILABLE');
  end if;
  if lower(btrim(p_signed_name))<>lower(btrim(v_request.signer_name)) then
    return jsonb_build_object('ok',false,'code','SIGNER_NAME_MISMATCH');
  end if;
  v_signed_at:=clock_timestamp();
  v_hash:=encode(extensions.digest(convert_to(concat_ws('|',v_request.document_hash,lower(btrim(p_signed_name)),
    lower(v_request.signer_email),v_request.consent_text,v_signed_at::text,gen_random_uuid()::text),'UTF8'),'sha256'),'hex');
  update global.document_signature_requests set status='signed',signed_name=btrim(p_signed_name),
    signed_at=v_signed_at,signature_hash=v_hash where id=v_request.id;
  insert into global.audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata,occurred_at)
  values(v_request.workspace_id,null,'document.signature.signed','document_signature',v_request.id::text,
    jsonb_build_object('document_type',v_request.document_type,'document_number',v_request.document_number,
      'signer_email',v_request.signer_email,'signed_name',btrim(p_signed_name),
      'document_hash',v_request.document_hash,'signature_hash',v_hash,'consent_text',v_request.consent_text),v_signed_at);
  return jsonb_build_object('ok',true,'requestId',v_request.id,'documentNumber',v_request.document_number,
    'signedAt',v_signed_at,'signatureHash',v_hash,'documentHash',v_request.document_hash);
end $$;

create or replace function public.global_document_signature_revoke(
  p_user_id uuid,p_workspace_id uuid,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog,global
as $$
declare v_member global.workspace_members%rowtype; v_id uuid;
begin
  select * into v_member from global.workspace_members
    where workspace_id=p_workspace_id and user_id=p_user_id and status='active' limit 1;
  if v_member.id is null then return jsonb_build_object('ok',false,'code','ACCESS_DENIED'); end if;
  if v_member.role not in ('owner','admin','manager','accountant') then
    return jsonb_build_object('ok',false,'code','PERMISSION_DENIED');
  end if;
  update global.document_signature_requests set status='revoked',revoked_by=p_user_id,revoked_at=now()
    where workspace_id=p_workspace_id and id=p_request_id and status='pending'
    returning id into v_id;
  if v_id is null then return jsonb_build_object('ok',false,'code','SIGNATURE_REQUEST_NOT_REVOCABLE'); end if;
  insert into global.audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata,occurred_at)
  values(p_workspace_id,p_user_id,'document.signature.revoked','document_signature',v_id::text,'{}'::jsonb,now());
  return jsonb_build_object('ok',true,'requestId',v_id,'status','revoked');
end $$;

revoke all on function global.prevent_document_signature_snapshot_mutation() from public,anon,authenticated;
revoke all on function public.global_document_signature_create(uuid,uuid,text,uuid,text,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.global_document_signature_list(uuid,uuid) from public,anon,authenticated;
revoke all on function public.global_document_signature_read(text) from public,anon,authenticated;
revoke all on function public.global_document_signature_sign(text,text,boolean) from public,anon,authenticated;
revoke all on function public.global_document_signature_revoke(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.global_document_signature_create(uuid,uuid,text,uuid,text,text,text,timestamptz) to service_role;
grant execute on function public.global_document_signature_list(uuid,uuid) to service_role;
grant execute on function public.global_document_signature_read(text) to service_role;
grant execute on function public.global_document_signature_sign(text,text,boolean) to service_role;
grant execute on function public.global_document_signature_revoke(uuid,uuid,uuid) to service_role;

commit;
