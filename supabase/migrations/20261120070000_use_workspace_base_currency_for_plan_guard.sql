-- Base currency is part of the workspace's included core functionality.
-- Only a currency different from the workspace's canonical currency requires
-- the multi_currency plan feature. Keep the existing plan guard and limits intact.
DO $migration$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('public.enforce_plan_limit()'::regprocedure)
    INTO v_def;

  IF position($old$elsif TG_TABLE_NAME = 'invoices' and upper(coalesce(to_jsonb(NEW)->>'currency', 'INR')) <> 'INR' then$old$ in v_def) = 0 THEN
    RAISE EXCEPTION 'Expected invoice multi-currency insert guard was not found; no change applied';
  END IF;

  v_def := replace(
    v_def,
    $old$elsif TG_TABLE_NAME = 'invoices' and upper(coalesce(to_jsonb(NEW)->>'currency', 'INR')) <> 'INR' then$old$,
    $new$elsif TG_TABLE_NAME = 'invoices'
    and upper(coalesce(to_jsonb(NEW)->>'currency', 'INR')) <>
      coalesce((
        select upper(trim(currency_code))
        from public.workspace_settings
        where workspace_id = v_ws
      ), 'INR') then$new$
  );
  EXECUTE v_def;

  SELECT pg_get_functiondef('public.enforce_plan_update_guard()'::regprocedure)
    INTO v_def;

  IF position($old$IF upper(coalesce(NEW.currency,'INR')) <> 'INR'
       AND NOT public.plan_feature_allowed(NEW.workspace_id,'multi_currency') THEN$old$ in v_def) = 0 THEN
    RAISE EXCEPTION 'Expected invoice multi-currency update guard was not found; no change applied';
  END IF;

  v_def := replace(
    v_def,
    $old$IF upper(coalesce(NEW.currency,'INR')) <> 'INR'
       AND NOT public.plan_feature_allowed(NEW.workspace_id,'multi_currency') THEN$old$,
    $new$IF upper(coalesce(NEW.currency,'INR')) <>
       coalesce((
         select upper(trim(currency_code))
         from public.workspace_settings
         where workspace_id = NEW.workspace_id
       ), 'INR')
       AND NOT public.plan_feature_allowed(NEW.workspace_id,'multi_currency') THEN$new$
  );
  EXECUTE v_def;
END
$migration$;

COMMENT ON FUNCTION public.enforce_plan_limit() IS
  'Enforces workspace plan limits and requires multi_currency only when an invoice currency differs from workspace_settings.currency_code.';
COMMENT ON FUNCTION public.enforce_plan_update_guard() IS
  'Requires multi_currency only when an updated invoice currency differs from workspace_settings.currency_code; preserves team plan checks.';
