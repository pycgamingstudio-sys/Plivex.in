-- Close the legacy is_draft=false insert-default gap for non-India workspaces.
CREATE OR REPLACE FUNCTION public.set_invoice_workspace_base_currency_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  _base_currency text;
  _country_code text;
BEGIN
  SELECT upper(trim(country_code)), upper(trim(currency_code))
    INTO _country_code, _base_currency
  FROM public.workspace_settings
  WHERE workspace_id = NEW.workspace_id;

  IF _base_currency IS NULL OR _base_currency !~ '^[A-Z]{3}$' OR _country_code IS NULL THEN
    RAISE EXCEPTION 'workspace_country_or_base_currency_not_configured'
      USING ERRCODE = '23514';
  END IF;

  NEW.currency := _base_currency;
  IF _country_code <> 'IN' THEN
    NEW.is_draft := true;
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.set_invoice_workspace_base_currency_before_insert() IS
  'Sets canonical workspace currency and keeps non-India invoice inserts in draft state before validation.';
