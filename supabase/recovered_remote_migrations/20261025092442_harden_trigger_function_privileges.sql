
REVOKE EXECUTE ON FUNCTION public.enforce_plan_limit() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_plan_update_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_profile_server_fields() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_server_fields() FROM PUBLIC, anon, authenticated;
ALTER FUNCTION public.sync_subscription_payu_txnid() SET search_path = public, pg_temp;
