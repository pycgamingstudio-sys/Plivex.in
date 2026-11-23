-- Final platform capabilities: e-sign audit, OCR intake, WhatsApp delivery and public API/MCP.
begin;

create table if not exists global.document_signing_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references global.workspaces(id) on delete cascade,
  invoice_id uuid not null references global.invoices(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete restrict,
  signer_name text not null check (length(btrim(signer_name)) between 2 and 160),
  signer_email text not null check (length(btrim(signer_email)) between 3 and 254),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending' check (status in ('pending','signed','declined','expired','revoked')),
  document_sha256 text not null check (document_sha256 ~ '^[a-f0-9]{64}$'),
  signature_name text,
  consent_text text,
  signer_ip_hash text,
  signer_user_agent text,
  signed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'signed' and signature_name is not null and signed_at is not null and consent_text is not null)
      or status <> 'signed')
);
create index if not exists global_document_signing_workspace_idx
  on global.document_signing_requests(workspace_id, created_at desc);
create index if not exists global_document_signing_invoice_idx
  on global.document_signing_requests(workspace_id, invoice_id, created_at desc);

create table if not exists global.document_ocr_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references global.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  document_type text not null check (document_type in ('invoice','receipt','purchase_order','identity','other')),
  storage_path text not null,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp','application/pdf')),
  status text not null default 'queued' check (status in ('queued','processing','completed','failed')),
  extracted_data jsonb not null default '{}'::jsonb check (jsonb_typeof(extracted_data) = 'object'),
  model_name text,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists global_document_ocr_workspace_idx
  on global.document_ocr_jobs(workspace_id, created_at desc);

create table if not exists global.whatsapp_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references global.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  recipient_phone text not null check (recipient_phone ~ '^\\+[1-9][0-9]{7,14}$'),
  message_type text not null check (message_type in ('text','template')),
  template_name text,
  provider_message_id text,
  status text not null check (status in ('accepted','failed')),
  consent_confirmed boolean not null check (consent_confirmed = true),
  error_code text,
  created_at timestamptz not null default now()
);
create index if not exists global_whatsapp_workspace_idx
  on global.whatsapp_delivery_logs(workspace_id, created_at desc);

create table if not exists global.public_api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references global.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  label text not null check (length(btrim(label)) between 2 and 80),
  key_hash text not null unique check (key_hash ~ '^[a-f0-9]{64}$'),
  key_prefix text not null check (key_prefix ~ '^plx_[a-zA-Z0-9]{6}$'),
  scopes text[] not null default array['workspace.read','invoices.read','clients.read'],
  last_used_at timestamptz,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (cardinality(scopes) between 1 and 5),
  check (scopes <@ array['workspace.read','invoices.read','clients.read','mcp.read']::text[])
);
create index if not exists global_public_api_keys_workspace_idx
  on global.public_api_keys(workspace_id, created_at desc);
create index if not exists global_public_api_keys_active_idx
  on global.public_api_keys(key_hash) where revoked_at is null;

alter table global.document_signing_requests enable row level security;
alter table global.document_ocr_jobs enable row level security;
alter table global.whatsapp_delivery_logs enable row level security;
alter table global.public_api_keys enable row level security;

revoke all on global.document_signing_requests, global.document_ocr_jobs,
  global.whatsapp_delivery_logs, global.public_api_keys from public, anon, authenticated;
grant all on global.document_signing_requests, global.document_ocr_jobs,
  global.whatsapp_delivery_logs, global.public_api_keys to service_role;


create or replace function public.global_complete_document_signature(
  p_token_hash text,
  p_signature_name text,
  p_consent_text text,
  p_ip_hash text,
  p_user_agent text,
  p_signed_at timestamptz,
  p_audit_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, global
as $function$
declare
  v_request global.document_signing_requests%rowtype;
begin
  if p_token_hash !~ '^[a-f0-9]{64}
 or p_signature_name is null
    or length(btrim(p_signature_name)) < 2 or p_consent_text is null
    or p_ip_hash !~ '^[a-f0-9]{64}
 or p_audit_sha256 !~ '^[a-f0-9]{64}
 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_SIGNATURE');
  end if;

  select * into v_request
  from global.document_signing_requests
  where token_hash = p_token_hash
  for update;

  if not found then return jsonb_build_object('ok', false, 'code', 'SIGN_REQUEST_NOT_FOUND'); end if;
  if v_request.status <> 'pending' or v_request.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'SIGN_REQUEST_NOT_ACTIVE');
  end if;
  if lower(v_request.signer_name) <> lower(btrim(p_signature_name)) then
    return jsonb_build_object('ok', false, 'code', 'SIGNER_NAME_MISMATCH');
  end if;

  update global.document_signing_requests
  set status = 'signed', signature_name = btrim(p_signature_name),
      consent_text = p_consent_text, signer_ip_hash = p_ip_hash,
      signer_user_agent = left(coalesce(p_user_agent, ''), 500),
      signed_at = p_signed_at, updated_at = p_signed_at
  where id = v_request.id;

  insert into global.audit_events(
    workspace_id, actor_id, action, entity_type, entity_id, metadata, occurred_at
  ) values (
    v_request.workspace_id, null, 'document.electronically_signed', 'invoice',
    v_request.invoice_id::text,
    jsonb_build_object(
      'signature_request_id', v_request.id,
      'signer_email', v_request.signer_email,
      'document_sha256', v_request.document_sha256,
      'audit_sha256', p_audit_sha256,
      'signed_at', p_signed_at
    ), p_signed_at
  );

  return jsonb_build_object(
    'ok', true, 'signed_at', p_signed_at,
    'document_sha256', v_request.document_sha256,
    'audit_sha256', p_audit_sha256
  );
end;
$function$;

revoke all on function public.global_complete_document_signature(text,text,text,text,text,timestamptz,text) from public, anon, authenticated;
grant execute on function public.global_complete_document_signature(text,text,text,text,text,timestamptz,text) to service_role;

commit;
