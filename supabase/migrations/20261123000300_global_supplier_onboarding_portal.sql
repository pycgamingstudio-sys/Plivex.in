-- Workspace-scoped supplier self-service onboarding with single-use invitation tokens.
begin;

create table if not exists global.supplier_onboarding_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  supplier_id uuid not null,
  legal_name text not null check (length(btrim(legal_name)) between 1 and 200),
  contact_name text not null check (length(btrim(contact_name)) between 1 and 160),
  email text not null check (length(email) <= 254),
  phone text check (phone is null or length(phone) <= 40),
  tax_registration_number text check (tax_registration_number is null or length(tax_registration_number) <= 80),
  website text check (website is null or length(website) <= 200),
  business_type text check (business_type is null or length(business_type) <= 100),
  payment_terms text check (payment_terms is null or payment_terms in ('due_on_receipt','net_7','net_15','net_30','net_45','net_60','custom')),
  address jsonb not null default '{}'::jsonb check (jsonb_typeof(address) = 'object'),
  status text not null default 'invited' check (status in ('invited','submitted','approved','rejected')),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  review_note text check (review_note is null or length(review_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, supplier_id),
  foreign key (workspace_id, supplier_id) references global.suppliers(workspace_id, id) on delete cascade
);
create index if not exists global_supplier_onboarding_workspace_status_idx
  on global.supplier_onboarding_profiles(workspace_id, status, updated_at desc);

create table if not exists global.supplier_portal_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  supplier_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'active' check (status in ('active','used','revoked','expired')),
  expires_at timestamptz not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  used_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, supplier_id) references global.suppliers(workspace_id, id) on delete cascade,
  check (expires_at > created_at)
);
create index if not exists global_supplier_portal_invites_workspace_idx
  on global.supplier_portal_invites(workspace_id, supplier_id, created_at desc);
create index if not exists global_supplier_portal_invites_expiry_idx
  on global.supplier_portal_invites(expires_at) where status = 'active';

alter table global.supplier_onboarding_profiles enable row level security;
alter table global.supplier_portal_invites enable row level security;
revoke all on global.supplier_onboarding_profiles, global.supplier_portal_invites from public, anon, authenticated;
grant all on global.supplier_onboarding_profiles, global.supplier_portal_invites to service_role;

create or replace function public.global_supplier_portal_invite(
  p_user_id uuid, p_workspace_id uuid, p_supplier_id uuid,
  p_name text, p_email text, p_phone text, p_tax_registration_number text,
  p_token_hash text, p_expires_at timestamptz
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,global
as $$
declare v_role text; v_supplier_id uuid; v_invite_id uuid;
begin
  if p_user_id is null or p_workspace_id is null or p_name is null or length(btrim(p_name)) not between 1 and 200
    or p_email is null or length(p_email)>254 or p_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'
    or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$'
    or p_expires_at <= now() or p_expires_at > now() + interval '8 days'
    or (p_phone is not null and length(p_phone)>40)
    or (p_tax_registration_number is not null and length(p_tax_registration_number)>80) then
    return jsonb_build_object('ok',false,'reason','invalid_invite');
  end if;
  select role into v_role from global.workspace_members
    where workspace_id=p_workspace_id and user_id=p_user_id and status='active' limit 1;
  if v_role is null then return jsonb_build_object('ok',false,'reason','access_denied'); end if;
  if v_role not in ('owner','admin','manager') then return jsonb_build_object('ok',false,'reason','forbidden'); end if;

  if p_supplier_id is null then
    insert into global.suppliers(workspace_id,name,email,phone,tax_registration_number,created_by)
    values(p_workspace_id,trim(p_name),lower(trim(p_email)),nullif(trim(p_phone),''),nullif(trim(p_tax_registration_number),''),p_user_id)
    returning id into v_supplier_id;
  else
    update global.suppliers set name=trim(p_name),email=lower(trim(p_email)),
      phone=nullif(trim(p_phone),''),tax_registration_number=nullif(trim(p_tax_registration_number),'')
      where workspace_id=p_workspace_id and id=p_supplier_id returning id into v_supplier_id;
    if v_supplier_id is null then return jsonb_build_object('ok',false,'reason','supplier_not_found'); end if;
  end if;

  insert into global.supplier_onboarding_profiles(
    workspace_id,supplier_id,legal_name,contact_name,email,phone,tax_registration_number,status
  ) values (
    p_workspace_id,v_supplier_id,trim(p_name),trim(p_name),lower(trim(p_email)),
    nullif(trim(p_phone),''),nullif(trim(p_tax_registration_number),''),'invited'
  )
  on conflict (workspace_id,supplier_id) do update set
    legal_name=excluded.legal_name,email=excluded.email,phone=excluded.phone,
    tax_registration_number=excluded.tax_registration_number,status='invited',
    submitted_at=null,reviewed_at=null,reviewed_by=null,review_note=null,updated_at=now();

  update global.supplier_portal_invites set status='revoked'
    where workspace_id=p_workspace_id and supplier_id=v_supplier_id and status='active';
  insert into global.supplier_portal_invites(workspace_id,supplier_id,token_hash,status,expires_at,created_by)
  values(p_workspace_id,v_supplier_id,p_token_hash,'active',p_expires_at,p_user_id)
  returning id into v_invite_id;
  return jsonb_build_object('ok',true,'supplier_id',v_supplier_id,'invite_id',v_invite_id);
end $$;

create or replace function public.global_supplier_portal_read(p_token_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,global
as $$
declare v_result jsonb;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok',false,'reason','invalid_or_expired');
  end if;
  select jsonb_build_object('ok',true,'supplier',jsonb_build_object(
    'supplier_id',s.id,'name',s.name,'email',s.email,'phone',s.phone,
    'tax_registration_number',s.tax_registration_number,
    'legal_name',p.legal_name,'contact_name',p.contact_name,'website',p.website,
    'business_type',p.business_type,'payment_terms',p.payment_terms,'address',p.address
  )) into v_result
  from global.supplier_portal_invites i
  join global.suppliers s on s.workspace_id=i.workspace_id and s.id=i.supplier_id
  left join global.supplier_onboarding_profiles p on p.workspace_id=i.workspace_id and p.supplier_id=i.supplier_id
  where i.token_hash=p_token_hash and i.status='active' and i.expires_at>now();
  return coalesce(v_result,jsonb_build_object('ok',false,'reason','invalid_or_expired'));
end $$;

create or replace function public.global_supplier_portal_submit(p_token_hash text,p_profile jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,global
as $$
declare v_invite global.supplier_portal_invites%rowtype; v_legal text; v_contact text; v_email text; v_phone text;
  v_tax text; v_website text; v_business text; v_terms text; v_address jsonb;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_profile)<>'object' then
    return jsonb_build_object('ok',false,'reason','invalid_submission');
  end if;
  v_legal:=nullif(btrim(p_profile->>'legal_name'),'');
  v_contact:=nullif(btrim(p_profile->>'contact_name'),'');
  v_email:=lower(nullif(btrim(p_profile->>'email'),''));
  v_phone:=nullif(btrim(p_profile->>'phone'),'');
  v_tax:=nullif(btrim(p_profile->>'tax_registration_number'),'');
  v_website:=nullif(btrim(p_profile->>'website'),'');
  v_business:=nullif(btrim(p_profile->>'business_type'),'');
  v_terms:=nullif(p_profile->>'payment_terms','');
  v_address:=coalesce(p_profile->'address','{}'::jsonb);
  if v_legal is null or length(v_legal)>200 or v_contact is null or length(v_contact)>160
    or v_email is null or length(v_email)>254 or v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'
    or (v_phone is not null and length(v_phone)>40) or (v_tax is not null and length(v_tax)>80)
    or (v_website is not null and (length(v_website)>200 or v_website !~ '^https://'))
    or (v_business is not null and length(v_business)>100)
    or (v_terms is not null and v_terms not in ('due_on_receipt','net_7','net_15','net_30','net_45','net_60','custom'))
    or jsonb_typeof(v_address)<>'object' or length(v_address::text)>4000 then
    return jsonb_build_object('ok',false,'reason','invalid_submission');
  end if;
  select * into v_invite from global.supplier_portal_invites
    where token_hash=p_token_hash and status='active' and expires_at>now() for update;
  if v_invite.id is null then return jsonb_build_object('ok',false,'reason','invalid_or_expired'); end if;

  update global.suppliers set name=v_legal,email=v_email,phone=v_phone,tax_registration_number=v_tax
    where workspace_id=v_invite.workspace_id and id=v_invite.supplier_id;
  insert into global.supplier_onboarding_profiles(
    workspace_id,supplier_id,legal_name,contact_name,email,phone,tax_registration_number,
    website,business_type,payment_terms,address,status,submitted_at,updated_at
  ) values (
    v_invite.workspace_id,v_invite.supplier_id,v_legal,v_contact,v_email,v_phone,v_tax,
    v_website,v_business,v_terms,v_address,'submitted',now(),now()
  )
  on conflict (workspace_id,supplier_id) do update set
    legal_name=excluded.legal_name,contact_name=excluded.contact_name,email=excluded.email,
    phone=excluded.phone,tax_registration_number=excluded.tax_registration_number,
    website=excluded.website,business_type=excluded.business_type,payment_terms=excluded.payment_terms,
    address=excluded.address,status='submitted',submitted_at=now(),reviewed_at=null,reviewed_by=null,review_note=null,updated_at=now();
  update global.supplier_portal_invites set status='used',used_at=now() where id=v_invite.id;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.global_supplier_portal_list(p_user_id uuid,p_workspace_id uuid,p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path=pg_catalog,global
as $$
declare v_role text; v_rows jsonb;
begin
  select role into v_role from global.workspace_members
    where workspace_id=p_workspace_id and user_id=p_user_id and status='active' limit 1;
  if v_role is null then return jsonb_build_object('ok',false,'reason','access_denied'); end if;
  if v_role not in ('owner','admin','manager') then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.updated_at desc),'[]'::jsonb) into v_rows
  from (
    select s.id as supplier_id,s.name,s.email,s.phone,s.tax_registration_number,
      p.legal_name,p.contact_name,p.website,p.business_type,p.payment_terms,p.address,
      p.status,p.submitted_at,p.reviewed_at,p.review_note,p.updated_at,
      i.status as invite_status,i.expires_at as invite_expires_at
    from global.supplier_onboarding_profiles p
    join global.suppliers s on s.workspace_id=p.workspace_id and s.id=p.supplier_id
    left join lateral (
      select status,expires_at from global.supplier_portal_invites
      where workspace_id=p.workspace_id and supplier_id=p.supplier_id
      order by created_at desc limit 1
    ) i on true
    where p.workspace_id=p_workspace_id
    order by p.updated_at desc
    limit greatest(1,least(coalesce(p_limit,100),300))
  ) x;
  return jsonb_build_object('ok',true,'records',v_rows);
end $$;

create or replace function public.global_supplier_portal_decide(
  p_user_id uuid,p_workspace_id uuid,p_supplier_id uuid,p_decision text,p_note text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,global
as $$
declare v_role text; v_id uuid;
begin
  select role into v_role from global.workspace_members
    where workspace_id=p_workspace_id and user_id=p_user_id and status='active' limit 1;
  if v_role is null then return jsonb_build_object('ok',false,'reason','access_denied'); end if;
  if v_role not in ('owner','admin','manager') then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  if p_decision not in ('approved','rejected') or (p_note is not null and length(p_note)>1000) then
    return jsonb_build_object('ok',false,'reason','invalid_decision');
  end if;
  update global.supplier_onboarding_profiles set status=p_decision,reviewed_at=now(),reviewed_by=p_user_id,
    review_note=nullif(btrim(p_note),''),updated_at=now()
  where workspace_id=p_workspace_id and supplier_id=p_supplier_id and status='submitted'
  returning supplier_id into v_id;
  if v_id is null then return jsonb_build_object('ok',false,'reason','submission_not_found'); end if;
  return jsonb_build_object('ok',true,'supplier_id',v_id,'status',p_decision);
end $$;

revoke all on function public.global_supplier_portal_invite(uuid,uuid,uuid,text,text,text,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.global_supplier_portal_read(text) from public,anon,authenticated;
revoke all on function public.global_supplier_portal_submit(text,jsonb) from public,anon,authenticated;
revoke all on function public.global_supplier_portal_list(uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.global_supplier_portal_decide(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.global_supplier_portal_invite(uuid,uuid,uuid,text,text,text,text,text,timestamptz) to service_role;
grant execute on function public.global_supplier_portal_read(text) to service_role;
grant execute on function public.global_supplier_portal_submit(text,jsonb) to service_role;
grant execute on function public.global_supplier_portal_list(uuid,uuid,integer) to service_role;
grant execute on function public.global_supplier_portal_decide(uuid,uuid,uuid,text,text) to service_role;

commit;
