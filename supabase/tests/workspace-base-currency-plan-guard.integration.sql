\set ON_ERROR_STOP on
-- Run after all migrations in the disposable PostgreSQL integration database.
DO $workspace_base_currency_plan_guard$
DECLARE
  v_insert_guard text;
  v_update_guard text;
BEGIN
  SELECT pg_get_functiondef('public.enforce_plan_limit()'::regprocedure)
    INTO v_insert_guard;
  SELECT pg_get_functiondef('public.enforce_plan_update_guard()'::regprocedure)
    INTO v_update_guard;

  IF position('workspace_settings' in v_insert_guard) = 0
     OR position('currency_code' in v_insert_guard) = 0
     OR position('plan_feature_allowed(v_ws, v_feature)' in v_insert_guard) = 0 THEN
    RAISE EXCEPTION 'Invoice insert guard does not compare against the workspace base currency while preserving the premium feature check';
  END IF;

  IF position('workspace_settings' in v_update_guard) = 0
     OR position('currency_code' in v_update_guard) = 0
     OR position('plan_feature_allowed(NEW.workspace_id,''multi_currency'')' in v_update_guard) = 0 THEN
    RAISE EXCEPTION 'Invoice update guard does not compare against the workspace base currency while preserving the premium feature check';
  END IF;

  IF position('to_jsonb(NEW)->>''currency'', ''INR'')) <> ''INR''' in v_insert_guard) > 0
     OR position('upper(coalesce(NEW.currency,''INR'')) <> ''INR''' in v_update_guard) > 0 THEN
    RAISE EXCEPTION 'Legacy INR-only multi-currency guard remains active';
  END IF;
END
$workspace_base_currency_plan_guard$;

SELECT 'PASS workspace base currency is exempt from multi_currency premium gating on invoice insert and update' AS result;
