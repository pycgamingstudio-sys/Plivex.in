CREATE OR REPLACE FUNCTION public.protect_server_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF (to_jsonb(NEW)->'workspace_id') IS DISTINCT FROM (to_jsonb(OLD)->'workspace_id')
     OR (to_jsonb(NEW)->'created_at') IS DISTINCT FROM (to_jsonb(OLD)->'created_at') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='IMMUTABLE_SERVER_FIELDS';
  END IF;
  IF TG_TABLE_NAME = 'invoices'
     AND (to_jsonb(NEW)->'created_by') IS DISTINCT FROM (to_jsonb(OLD)->'created_by') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='IMMUTABLE_SERVER_FIELDS';
  END IF;
  IF TG_TABLE_NAME = 'workspace_members'
     AND (to_jsonb(NEW)->'owner_id') IS DISTINCT FROM (to_jsonb(OLD)->'owner_id') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='IMMUTABLE_SERVER_FIELDS';
  END IF;
  RETURN NEW;
END;
$function$;
