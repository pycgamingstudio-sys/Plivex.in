-- Ensure every newly inserted invoice starts with the canonical workspace currency.
-- This runs before enforce_workspace_invoice_currency, preventing the table's legacy
-- INR default from rejecting non-India invoice creation before save_invoice updates it.
CREATE OR REPLACE FUNCTION public.set_invoice_workspace_base_currency_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  _base_currency text;
BEGIN
  SELECT upper(trim(currency_code))
    INTO _base_currency
  FROM public.workspace_settings
  WHERE workspace_id = NEW.workspace_id;

  IF _base_currency IS NULL OR _base_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'workspace_base_currency_not_configured'
      USING ERRCODE = '23514';
  END IF;

  NEW.currency := _base_currency;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS a_set_invoice_workspace_base_currency ON public.invoices;
CREATE TRIGGER a_set_invoice_workspace_base_currency
BEFORE INSERT ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.set_invoice_workspace_base_currency_before_insert();

COMMENT ON FUNCTION public.set_invoice_workspace_base_currency_before_insert() IS
  'Sets new invoice currency from canonical workspace_settings before currency validation runs.';
