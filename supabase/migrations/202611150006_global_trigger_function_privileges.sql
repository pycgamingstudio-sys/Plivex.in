-- Remove default PUBLIC execution from the Global timestamp trigger helper.
-- Trigger invocation does not require callers to have EXECUTE on the trigger function.
begin;

revoke all on function global.set_updated_at() from public, anon, authenticated;

comment on function global.set_updated_at() is
  'Internal Global updated_at trigger helper; not callable by API roles.';

commit;
