-- Fix address object-size validation without relying on a nonexistent jsonb_object_length() function.
create or replace function public.submit_main_workspace_supplier_profile(p_token_hash text,p_phone text,p_tax_country_code text,p_tax_id text,p_address jsonb,p_payment_terms text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_invite public.supplier_invitation_tokens%rowtype;v_supplier public.suppliers%rowtype;v_country text;v_address_keys integer;
begin
 if p_address is not null and jsonb_typeof(p_address)='object' then select count(*) into v_address_keys from jsonb_object_keys(p_address); else v_address_keys:=0; end if;
 if p_token_hash is null or length(p_token_hash)<>64 or p_token_hash ~ '[^a-f0-9]' or p_tax_country_code is null or p_tax_country_code !~ '^[A-Z]{2,3}$'
  or length(coalesce(p_phone,''))>32 or length(coalesce(p_tax_id,''))>80 or p_address is null or jsonb_typeof(p_address)<>'object'
  or v_address_keys>12 or length(coalesce(p_payment_terms,''))>200 then return jsonb_build_object('ok',false,'reason','invalid_supplier_profile'); end if;
 select * into v_invite from public.supplier_invitation_tokens where token_hash=p_token_hash for update;
 if not found or v_invite.used_at is not null or v_invite.revoked_at is not null or v_invite.expires_at<=now() then return jsonb_build_object('ok',false,'reason','invite_not_active'); end if;
 select country_code into v_country from public.workspace_settings where workspace_id=v_invite.workspace_id;
 if v_country is null or upper(v_country)<>upper(p_tax_country_code) then return jsonb_build_object('ok',false,'reason','tax_country_mismatch'); end if;
 select * into v_supplier from public.suppliers where workspace_id=v_invite.workspace_id and id=v_invite.supplier_id for update;
 if not found or v_supplier.status<>'invited' then return jsonb_build_object('ok',false,'reason','supplier_not_invited'); end if;
 update public.suppliers set phone=nullif(btrim(p_phone),''),tax_country_code=upper(p_tax_country_code),tax_id=nullif(btrim(p_tax_id),''),address=p_address,payment_terms=nullif(btrim(p_payment_terms),''),status='submitted',submitted_at=now(),updated_at=now() where id=v_supplier.id;
 update public.supplier_invitation_tokens set used_at=now() where id=v_invite.id;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) values(v_invite.workspace_id,null,'supplier.profile_submitted','supplier',v_supplier.id::text,'{}'::jsonb);
 return jsonb_build_object('ok',true,'supplier_id',v_supplier.id);
end; $function$;
revoke all on function public.submit_main_workspace_supplier_profile(text,text,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.submit_main_workspace_supplier_profile(text,text,text,text,jsonb,text) to service_role;
