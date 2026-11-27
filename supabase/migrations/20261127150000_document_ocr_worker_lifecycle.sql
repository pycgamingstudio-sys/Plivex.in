-- Document OCR worker lifecycle: bounded retries, stale-lease recovery and service-role-only RPCs.
-- This migration is additive. It does not enable client-side writes or call a paid OCR provider.

alter table public.document_ocr_jobs
  add column if not exists attempt_count integer not null default 0,
  add column if not exists max_attempts integer not null default 3,
  add column if not exists locked_at timestamptz,
  add column if not exists last_error text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.document_ocr_jobs'::regclass
      and conname = 'document_ocr_jobs_attempt_bounds_check'
  ) then
    alter table public.document_ocr_jobs
      add constraint document_ocr_jobs_attempt_bounds_check
      check (attempt_count >= 0 and max_attempts between 1 and 10);
  end if;
end $$;

create index if not exists document_ocr_jobs_queue_idx
  on public.document_ocr_jobs (created_at, id)
  where status = 'queued';

create index if not exists document_ocr_jobs_stale_lease_idx
  on public.document_ocr_jobs (locked_at, id)
  where status = 'processing';

create or replace function public.claim_document_ocr_jobs(p_batch_size integer default 5)
returns setof public.document_ocr_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 20 then
    raise exception 'invalid batch size' using errcode = '22023';
  end if;

  update public.document_ocr_jobs
  set status = 'failed',
      error_code = 'worker_lease_expired',
      last_error = 'worker_lease_expired',
      locked_at = null,
      completed_at = now()
  where status = 'processing'
    and (locked_at is null or locked_at < now() - interval '15 minutes')
    and attempt_count >= max_attempts;

  return query
  with candidates as (
    select j.id
    from public.document_ocr_jobs j
    where j.attempt_count < j.max_attempts
      and (
        j.status = 'queued'
        or (j.status = 'processing' and (j.locked_at is null or j.locked_at < now() - interval '15 minutes'))
      )
    order by j.created_at, j.id
    for update skip locked
    limit p_batch_size
  )
  update public.document_ocr_jobs j
  set status = 'processing',
      attempt_count = j.attempt_count + 1,
      locked_at = now(),
      last_error = null
  from candidates c
  where j.id = c.id
  returning j.*;
end;
$$;

create or replace function public.complete_document_ocr_job(
  p_job_id uuid,
  p_extracted_data jsonb,
  p_model_name text
)
returns public.document_ocr_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.document_ocr_jobs;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_extracted_data is null or jsonb_typeof(p_extracted_data) <> 'object' then
    raise exception 'extracted data must be a JSON object' using errcode = '22023';
  end if;
  if p_model_name is null or length(btrim(p_model_name)) not between 1 and 120 then
    raise exception 'invalid model name' using errcode = '22023';
  end if;

  update public.document_ocr_jobs
  set status = 'completed',
      extracted_data = p_extracted_data,
      model_name = btrim(p_model_name),
      completed_at = now(),
      locked_at = null,
      last_error = null
  where id = p_job_id and status = 'processing'
  returning * into v_job;

  if v_job.id is null then
    raise exception 'job not found or not processing' using errcode = 'P0002';
  end if;
  return v_job;
end;
$$;

create or replace function public.fail_document_ocr_job(p_job_id uuid, p_error_code text)
returns public.document_ocr_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.document_ocr_jobs;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_error_code is null or length(btrim(p_error_code)) not between 1 and 80 then
    raise exception 'invalid error code' using errcode = '22023';
  end if;

  update public.document_ocr_jobs
  set status = case when attempt_count >= max_attempts then 'failed' else 'queued' end,
      error_code = case when attempt_count >= max_attempts then btrim(p_error_code) else null end,
      last_error = btrim(p_error_code),
      locked_at = null,
      completed_at = case when attempt_count >= max_attempts then now() else null end
  where id = p_job_id and status = 'processing'
  returning * into v_job;

  if v_job.id is null then
    raise exception 'job not found or not processing' using errcode = 'P0002';
  end if;
  return v_job;
end;
$$;

revoke all on function public.claim_document_ocr_jobs(integer) from public, anon, authenticated;
revoke all on function public.complete_document_ocr_job(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.fail_document_ocr_job(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_document_ocr_jobs(integer) to service_role;
grant execute on function public.complete_document_ocr_job(uuid, jsonb, text) to service_role;
grant execute on function public.fail_document_ocr_job(uuid, text) to service_role;
