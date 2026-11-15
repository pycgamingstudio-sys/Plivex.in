DROP TRIGGER IF EXISTS on_auth_user_created_plivex ON auth.users;
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n
  FROM pg_trigger t
  JOIN pg_class c ON c.oid=t.tgrelid
  JOIN pg_namespace s ON s.oid=c.relnamespace
  WHERE NOT t.tgisinternal AND s.nspname='auth' AND c.relname='users'
    AND t.tgfoid='public.handle_new_user()'::regprocedure;
  IF n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one handle_new_user auth trigger, found %', n;
  END IF;
END $$;
