\set ON_ERROR_STOP on
-- Runs only against the disposable migration replay database.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','66666666-6666-4666-8666-666666666666',true);

DO $quotation_wrapper_auth$
DECLARE
  v_spoofed jsonb;
  v_valid jsonb;
BEGIN
  v_spoofed := public.global_manage_quotation(
    '77777777-7777-4777-8777-777777777777',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'list',NULL,NULL,NULL,NULL,NULL,NULL,'[]'::jsonb,NULL,NULL,NULL,NULL
  );
  IF v_spoofed->>'ok' <> 'false' OR v_spoofed->>'reason' <> 'access_denied' THEN
    RAISE EXCEPTION 'Quotation wrapper accepted a spoofed user id: %',v_spoofed;
  END IF;

  v_valid := public.global_manage_quotation(
    '66666666-6666-4666-8666-666666666666',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'list',NULL,NULL,NULL,NULL,NULL,NULL,'[]'::jsonb,NULL,NULL,NULL,NULL
  );
  IF v_valid->>'ok' <> 'true' THEN
    RAISE EXCEPTION 'Quotation wrapper rejected the authenticated workspace member: %',v_valid;
  END IF;
END
$quotation_wrapper_auth$;

RESET ROLE;
ROLLBACK;
