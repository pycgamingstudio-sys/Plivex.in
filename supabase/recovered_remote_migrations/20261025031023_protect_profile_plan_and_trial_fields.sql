create or replace function public.protect_profile_server_fields()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.role()='service_role' then return new; end if;
 if tg_op='INSERT' then
   new.role:='employee'::public.app_role;
   new.workspace_id:=null;
   new.trial_start_at:=null;
   new.trial_expires_at:=null;
   new.created_at:=clock_timestamp();
   return new;
 end if;
 if new.id is distinct from old.id
    or new.role is distinct from old.role
    or new.workspace_id is distinct from old.workspace_id
    or new.trial_start_at is distinct from old.trial_start_at
    or new.trial_expires_at is distinct from old.trial_expires_at
    or new.created_at is distinct from old.created_at then
   raise exception using errcode='42501',message='PROFILE_SERVER_FIELDS_IMMUTABLE';
 end if;
 return new;
end $$;
drop trigger if exists protect_profile_server_fields on public.profiles;
create trigger protect_profile_server_fields before insert or update on public.profiles for each row execute function public.protect_profile_server_fields();
