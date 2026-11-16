-- Part 7: controlled tax-rule publication and immutable tax-calculation audit.
-- Candidate-only additive migration. Never apply to production without review.
begin;

do $block$
begin
  if not exists (select 1 from pg_constraint where conname = 'global_tax_rule_country_currency_check') then
    alter table global.tax_rule_versions add constraint global_tax_rule_country_currency_check
      check (
        (country_code = 'IN' and currency_code = 'INR') or
        (country_code = 'US' and currency_code = 'USD') or
        (country_code = 'GB' and currency_code = 'GBP') or
        (country_code = 'AE' and currency_code = 'AED') or
        (country_code = 'CA' and currency_code = 'CAD') or
        (country_code = 'AU' and currency_code = 'AUD') or
        (country_code = 'SG' and currency_code = 'SGD')
      ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'global_tax_rule_jurisdiction_required') then
    alter table global.tax_rule_versions add constraint global_tax_rule_jurisdiction_required
      check (country_code not in ('US','CA') or nullif(btrim(jurisdiction_id),'') is not null) not valid;
  end if;
end;
$block$;
alter table global.tax_rule_versions validate constraint global_tax_rule_country_currency_check;
alter table global.tax_rule_versions validate constraint global_tax_rule_jurisdiction_required;

create table if not exists global.tax_calculation_audit (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references global.workspaces(id) on delete cascade,
  invoice_id uuid not null,
  invoice_version integer not null check (invoice_version > 0),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  jurisdiction_id text,
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  rule_id uuid not null references global.tax_rule_versions(id) on delete restrict,
  rule_version text not null check (length(btrim(rule_version)) between 1 and 40),
  invoice_date date not null,
  taxable_minor bigint not null check (taxable_minor >= 0),
  tax_minor bigint not null check (tax_minor >= 0),
  total_minor bigint not null check (total_minor >= taxable_minor),
  calculation_snapshot jsonb not null
    check (jsonb_typeof(calculation_snapshot) = 'object' and octet_length(calculation_snapshot::text) <= 65536),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (workspace_id, invoice_id, invoice_version)
);
create index if not exists global_tax_audit_workspace_time_idx
  on global.tax_calculation_audit(workspace_id, created_at desc);
create index if not exists global_tax_audit_invoice_idx
  on global.tax_calculation_audit(workspace_id, invoice_id, invoice_version desc);
alter table global.tax_calculation_audit enable row level security;
create policy global_tax_audit_member_read on global.tax_calculation_audit
  for select to authenticated using (global.is_workspace_member(workspace_id));

create or replace function global.reject_tax_audit_mutation()
returns trigger language plpgsql set search_path = pg_catalog
as $function$
begin
  raise exception 'tax calculation audit records are append-only';
end;
$function$;
drop trigger if exists global_tax_audit_immutable on global.tax_calculation_audit;
create trigger global_tax_audit_immutable
  before update or delete on global.tax_calculation_audit
  for each row execute function global.reject_tax_audit_mutation();

-- Permit exactly one controlled draft -> verified transition; all published
-- rule snapshots remain immutable thereafter.
create or replace function global.guard_tax_rule_version_transition()
returns trigger language plpgsql set search_path = pg_catalog, global
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'tax rule snapshots are immutable';
  end if;
  if coalesce(auth.role(),'') <> 'service_role'
    or old.status <> 'draft' or new.status <> 'verified'
    or (to_jsonb(new) - array['status','reviewed_on','reviewed_by'])
       is distinct from (to_jsonb(old) - array['status','reviewed_on','reviewed_by']) then
    raise exception 'only service-role draft publication is allowed';
  end if;
  return new;
end;
$function$;
drop trigger if exists tax_rule_versions_immutable on global.tax_rule_versions;
create trigger tax_rule_versions_immutable
  before update or delete on global.tax_rule_versions
  for each row execute function global.guard_tax_rule_version_transition();

create or replace function public.global_publish_tax_rule_version(p_rule_id uuid, p_reviewer text)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, global
as $function$
declare v_rule global.tax_rule_versions%rowtype; v_source_ok boolean;
begin
  if coalesce(auth.role(),'') <> 'service_role' then return jsonb_build_object('ok',false,'code','SERVICE_ROLE_REQUIRED'); end if;
  if p_rule_id is null or length(btrim(coalesce(p_reviewer,''))) not between 1 and 120 then
    return jsonb_build_object('ok',false,'code','INVALID_REVIEW_INPUT');
  end if;
  select * into v_rule from global.tax_rule_versions where id=p_rule_id for update;
  if not found or v_rule.status <> 'draft' then return jsonb_build_object('ok',false,'code','DRAFT_RULE_REQUIRED'); end if;
  if (v_rule.country_code='IN' and v_rule.currency_code<>'INR')
    or (v_rule.country_code='US' and v_rule.currency_code<>'USD')
    or (v_rule.country_code='GB' and v_rule.currency_code<>'GBP')
    or (v_rule.country_code='AE' and v_rule.currency_code<>'AED')
    or (v_rule.country_code='CA' and v_rule.currency_code<>'CAD')
    or (v_rule.country_code='AU' and v_rule.currency_code<>'AUD')
    or (v_rule.country_code='SG' and v_rule.currency_code<>'SGD')
    or v_rule.country_code not in ('IN','US','GB','AE','CA','AU','SG') then
    return jsonb_build_object('ok',false,'code','COUNTRY_CURRENCY_MISMATCH');
  end if;
  if v_rule.country_code in ('US','CA') and nullif(btrim(v_rule.jurisdiction_id),'') is null then
    return jsonb_build_object('ok',false,'code','JURISDICTION_REQUIRED');
  end if;
  v_source_ok := case v_rule.country_code
    when 'IN' then v_rule.source_url ~* '^https://([a-z0-9-]+\.)*(cbic-gst\.gov\.in|gst\.gov\.in)(/|$)'
    when 'US' then v_rule.source_url ~* '^https://([a-z0-9-]+\.)*[a-z0-9-]+\.gov(/|$)'
    when 'GB' then v_rule.source_url ~* '^https://([a-z0-9-]+\.)*gov\.uk(/|$)'
    when 'AE' then v_rule.source_url ~* '^https://(tax\.gov\.ae|mof\.gov\.ae)(/|$)'
    when 'CA' then v_rule.source_url ~* '^https://(www\.)?(canada\.ca|revenuquebec\.ca|gouv\.qc\.ca)(/|$)'
    when 'AU' then v_rule.source_url ~* '^https://([a-z0-9-]+\.)*ato\.gov\.au(/|$)'
    when 'SG' then v_rule.source_url ~* '^https://([a-z0-9-]+\.)*iras\.gov\.sg(/|$)'
    else false end;
  if not coalesce(v_source_ok,false) or jsonb_typeof(v_rule.components)<>'array'
    or jsonb_array_length(v_rule.components)<1 or jsonb_array_length(v_rule.components)>8
    or exists (
      select 1 from jsonb_array_elements(v_rule.components) c
      where coalesce(c->>'id','')='' or coalesce(c->>'rateBps','') !~ '^[0-9]+$'
        or (c->>'rateBps')::numeric > 10000
    )
    or (select coalesce(sum((c->>'rateBps')::numeric),0) from jsonb_array_elements(v_rule.components) c) > 10000
    or (select count(*) from jsonb_array_elements(v_rule.components) c)
       <> (select count(distinct c->>'id') from jsonb_array_elements(v_rule.components) c) then
    return jsonb_build_object('ok',false,'code','RULE_SOURCE_OR_COMPONENT_INVALID');
  end if;
  if exists (
    select 1 from global.tax_rule_versions other
    where other.id<>v_rule.id and other.status='verified'
      and other.country_code=v_rule.country_code
      and coalesce(other.jurisdiction_id,'')=coalesce(v_rule.jurisdiction_id,'')
      and other.tax_code=v_rule.tax_code and other.treatment=v_rule.treatment
      and daterange(other.effective_from,coalesce(other.effective_to,'infinity'::date),'[]')
        && daterange(v_rule.effective_from,coalesce(v_rule.effective_to,'infinity'::date),'[]')
  ) then return jsonb_build_object('ok',false,'code','OVERLAPPING_VERIFIED_RULE'); end if;
  update global.tax_rule_versions set status='verified',reviewed_on=current_date,reviewed_by=btrim(p_reviewer)
    where id=p_rule_id;
  return jsonb_build_object('ok',true,'ruleId',p_rule_id,'version',v_rule.version);
end;
$function$;

create or replace function public.global_append_tax_calculation_audit(
  p_user_id uuid, p_workspace_id uuid, p_invoice_id uuid, p_invoice_version integer,
  p_snapshot jsonb
) returns uuid
language plpgsql security definer set search_path = pg_catalog, global
as $function$
declare v_id uuid; v_country text; v_currency text; v_rule_id uuid; v_rule_version text;
  v_jurisdiction text; v_date date; v_taxable bigint; v_tax bigint; v_total bigint;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service role required'; end if;
  if p_user_id is null or p_workspace_id is null or p_invoice_id is null
    or p_invoice_version is null or p_invoice_version<1
    or p_snapshot is null or jsonb_typeof(p_snapshot)<>'object'
    or octet_length(p_snapshot::text)>65536 then raise exception 'invalid tax audit snapshot'; end if;
  if not exists (select 1 from global.workspace_members
    where workspace_id=p_workspace_id and user_id=p_user_id and status='active') then
    raise exception 'active workspace membership required';
  end if;
  if coalesce(p_snapshot->>'countryCode','') !~ '^[A-Z]{2}$'
    or coalesce(p_snapshot->>'currencyCode','') !~ '^[A-Z]{3}$'
    or coalesce(p_snapshot->>'ruleId','') !~ '^[0-9a-fA-F-]{36}$'
    or coalesce(p_snapshot->>'ruleVersion','')=''
    or coalesce(p_snapshot->>'invoiceDate','') !~ '^\d{4}-\d{2}-\d{2}$'
    or coalesce(p_snapshot->>'taxableMinor','') !~ '^(0|[1-9][0-9]{0,15})$'
    or coalesce(p_snapshot->>'taxMinor','') !~ '^(0|[1-9][0-9]{0,15})$'
    or coalesce(p_snapshot->>'totalMinor','') !~ '^(0|[1-9][0-9]{0,15})$' then
    raise exception 'incomplete tax audit snapshot';
  end if;
  v_country := p_snapshot->>'countryCode'; v_currency := p_snapshot->>'currencyCode';
  v_rule_id := (p_snapshot->>'ruleId')::uuid; v_rule_version := p_snapshot->>'ruleVersion';
  v_jurisdiction := p_snapshot->>'jurisdictionId'; v_date := (p_snapshot->>'invoiceDate')::date;
  v_taxable := (p_snapshot->>'taxableMinor')::bigint; v_tax := (p_snapshot->>'taxMinor')::bigint;
  v_total := (p_snapshot->>'totalMinor')::bigint;
  if v_total <> v_taxable + v_tax or v_total > 9007199254740991
    or not exists (select 1 from global.tax_rule_versions r
    where r.id=v_rule_id and r.status='verified' and r.country_code=v_country
      and r.currency_code=v_currency and r.version=v_rule_version
      and coalesce(r.jurisdiction_id,'')=coalesce(v_jurisdiction,'')) then
    raise exception 'tax rule snapshot does not match a verified rule';
  end if;
  insert into global.tax_calculation_audit(
    workspace_id,invoice_id,invoice_version,country_code,jurisdiction_id,currency_code,
    rule_id,rule_version,invoice_date,taxable_minor,tax_minor,total_minor,calculation_snapshot,created_by
  ) values (
    p_workspace_id,p_invoice_id,p_invoice_version,v_country,v_jurisdiction,v_currency,
    v_rule_id,v_rule_version,v_date,v_taxable,v_tax,v_total,p_snapshot,p_user_id
  ) returning id into v_id;
  return v_id;
end;
$function$;

revoke all on function public.global_publish_tax_rule_version(uuid,text) from public, anon, authenticated;
revoke all on function public.global_append_tax_calculation_audit(uuid,uuid,uuid,integer,jsonb) from public, anon, authenticated;
grant execute on function public.global_publish_tax_rule_version(uuid,text) to service_role;
grant execute on function public.global_append_tax_calculation_audit(uuid,uuid,uuid,integer,jsonb) to service_role;
grant select on global.tax_rule_versions to service_role;
grant select on global.tax_calculation_audit to authenticated, service_role;
revoke insert, update, delete on global.tax_calculation_audit from anon, authenticated;
grant insert on global.tax_calculation_audit to service_role;

commit;
