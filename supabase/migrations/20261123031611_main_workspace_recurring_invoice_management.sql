-- List, pause, resume and cancel Main Workspace recurring invoice schedules.
begin;
create or replace function public.main_workspace_list_recurring_invoice_schedules(p_workspace_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid(); v_rows jsonb;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'source_invoice_id',s.source_invoice_id,'invoice_number',i.number,'frequency',s.frequency,'interval_count',s.interval_count,'next_run_on',s.next_run_on,'end_on',s.end_on,'status',s.status,'last_generated_at',s.last_generated_at,'created_at',s.created_at) order by s.created_at desc),'[]'::jsonb)
 into v_rows from public.recurring_invoice_schedules s join public.invoices i on i.id=s.source_invoice_id where s.workspace_id=p_workspace_id;
 return jsonb_build_object('ok',true,'schedules',v_rows);
end; $function$;
create or replace function public.main_workspace_recurring_schedule_set_status(p_workspace_id text,p_schedule_id uuid,p_status text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_user uuid:=auth.uid(); v_id uuid;
begin
 if v_user is null or not public.has_ws_role(p_workspace_id,array['admin'::app_role,'manager'::app_role]) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
 if p_status not in ('active','paused','cancelled') then return jsonb_build_object('ok',false,'reason','invalid_status'); end if;
 update public.recurring_invoice_schedules set status=p_status,updated_at=now() where workspace_id=p_workspace_id and id=p_schedule_id and status<>'completed' returning id into v_id;
 if v_id is null then return jsonb_build_object('ok',false,'reason','schedule_not_found_or_completed'); end if;
 insert into public.workspace_audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata)
 values(p_workspace_id,v_user,'recurring_invoice.schedule_'||p_status,'recurring_invoice_schedule',v_id::text,'{}'::jsonb);
 return jsonb_build_object('ok',true);
end; $function$;
revoke all on function public.main_workspace_list_recurring_invoice_schedules(text) from public,anon;
revoke all on function public.main_workspace_recurring_schedule_set_status(text,uuid,text) from public,anon;
grant execute on function public.main_workspace_list_recurring_invoice_schedules(text) to authenticated;
grant execute on function public.main_workspace_recurring_schedule_set_status(text,uuid,text) to authenticated;
commit;
