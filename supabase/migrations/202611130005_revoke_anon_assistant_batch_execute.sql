-- Restrict the assistant batch RPC to signed-in users and trusted backend roles.
-- The assistant-confirm Edge Function validates the caller with auth.getUser()
-- and forwards the caller's JWT, so its RPC executes as authenticated.
-- The function itself also rejects requests where auth.uid() is NULL.
-- Preserve authenticated and service_role execution; remove only the unnecessary
-- explicit anon grant observed in the live Supabase ACL.
REVOKE EXECUTE ON FUNCTION public.execute_assistant_action_batch(text, text, jsonb) FROM anon;
