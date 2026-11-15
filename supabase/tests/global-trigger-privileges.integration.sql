-- Disposable CI assertions for the Global timestamp trigger helper.
DO $global_trigger_privileges$
BEGIN
  IF has_function_privilege('anon', 'global.set_updated_at()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute the internal Global timestamp trigger helper';
  END IF;
  IF has_function_privilege('authenticated', 'global.set_updated_at()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can execute the internal Global timestamp trigger helper';
  END IF;
END
$global_trigger_privileges$;

CREATE TEMP TABLE global_trigger_privilege_probe (
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER global_trigger_privilege_probe_updated_at
  BEFORE UPDATE ON global_trigger_privilege_probe
  FOR EACH ROW EXECUTE FUNCTION global.set_updated_at();
INSERT INTO global_trigger_privilege_probe DEFAULT VALUES;
GRANT UPDATE ON global_trigger_privilege_probe TO authenticated;
SET ROLE authenticated;
UPDATE global_trigger_privilege_probe SET updated_at = now();
RESET ROLE;
