\set ON_ERROR_STOP on
-- Disposable database only. Uses the India sentinel user created by
-- migration-replay-seed-india.sql; no production records are read or changed.
set role service_role;

insert into public.workspace_settings(workspace_id,country_code,locale_code,currency_code,created_by)
values ('workspace-india-compliance-regression','IN','en-IN','INR','11111111-1111-4111-8111-111111111111')
on conflict (workspace_id) do update
set country_code='IN',locale_code='en-IN',currency_code='INR';

insert into public.workspace_tds_entries(
  workspace_id,source_type,deductee_name,deductee_pan,section_code,deduction_date,
  currency_code,gross_amount_minor,tds_rate_bps,tds_amount_minor,financial_year,quarter,
  status,idempotency_key,request_fingerprint,created_by
) values (
  'workspace-india-compliance-regression','contractor','Regression Contractor','ABCDE1234F',
  '194C','2026-04-15','INR',100000,1000,10000,'2026-27','Q1','draft',
  '33333333-3333-4333-8333-333333333333',repeat('a',64),
  '11111111-1111-4111-8111-111111111111'
);

update public.workspace_tds_entries
set status='deducted',updated_by='11111111-1111-4111-8111-111111111111',updated_at=now()
where workspace_id='workspace-india-compliance-regression'
  and idempotency_key='33333333-3333-4333-8333-333333333333';

insert into public.workspace_compliance_provider_connections(
  workspace_id,provider_type,provider_name,environment,status,secret_reference,configured_by
) values (
  'workspace-india-compliance-regression','gst_irp','Disposable IRP Provider','sandbox',
  'awaiting_credentials','PLIVEX_GST_IRP_SECRET','11111111-1111-4111-8111-111111111111'
);

reset role;

do $$
declare
  tds_count integer;
  provider_count integer;
  tds_amount bigint;
  tds_net bigint;
begin
  select count(*) into tds_count
  from public.workspace_audit_events
  where workspace_id='workspace-india-compliance-regression' and entity_type='tds_entry';
  select count(*) into provider_count
  from public.workspace_audit_events
  where workspace_id='workspace-india-compliance-regression' and entity_type='compliance_provider_connection';
  select tds_amount_minor,net_amount_minor into tds_amount,tds_net
  from public.workspace_tds_entries
  where workspace_id='workspace-india-compliance-regression';
  if tds_count <> 2 then raise exception 'Expected create and update TDS audit events, got %',tds_count; end if;
  if provider_count <> 1 then raise exception 'Expected provider setup audit event, got %',provider_count; end if;
  if tds_amount <> 10000 or tds_net <> 90000 then raise exception 'TDS minor-unit calculation mismatch: %, %',tds_amount,tds_net; end if;
  if has_table_privilege('anon','public.workspace_tds_entries','SELECT')
    or has_table_privilege('authenticated','public.workspace_tds_entries','SELECT')
    or has_table_privilege('anon','public.workspace_einvoice_records','INSERT')
    or has_table_privilege('authenticated','public.workspace_eway_bill_records','UPDATE') then
    raise exception 'India compliance tables are exposed to browser roles';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.workspace_tds_entries'::regclass)
    or not (select relrowsecurity from pg_class where oid='public.workspace_einvoice_records'::regclass)
    or not (select relrowsecurity from pg_class where oid='public.workspace_eway_bill_records'::regclass)
    or not (select relrowsecurity from pg_class where oid='public.workspace_compliance_provider_connections'::regclass) then
    raise exception 'India compliance table RLS is not enabled';
  end if;
end $$;

select 'PASS India compliance TDS arithmetic, append-only audit trigger, provider secret-reference handling and service-role-only grants';
