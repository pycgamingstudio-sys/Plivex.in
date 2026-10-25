-- This helper is used internally by SECURITY DEFINER functions and triggers; it is not a public RPC.
REVOKE EXECUTE ON FUNCTION public.workspace_cycle_start(text, timestamptz) FROM PUBLIC, anon, authenticated;
