-- Isolated PostgreSQL integration tests for the effective subscription priority migration.
-- This fixture intentionally models the two documented post-202610280004 outcomes.
\set ON_ERROR_STOP on
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user) $$;

CREATE TABLE public.workspaces(id text PRIMARY KEY);
CREATE TABLE public.subscriptions(
 id bigserial PRIMARY KEY, workspace_id text NOT NULL REFERENCES public.workspaces(id),
 tier text NOT NULL, status text NOT NULL, started_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION public.current_plan(p_workspace_id text)
RETURNS text LANGUAGE plpgsql STABLE AS $function$
DECLARE v_plan text;
BEGIN
 SELECT s.tier INTO v_plan FROM public.subscriptions s
 WHERE s.workspace_id = p_workspace_id AND s.status::text = 'active'
   AND s.expires_at > clock_timestamp() AND s.started_at <= clock_timestamp()
 ORDER BY case s.tier::text when 'pro' then 2 when 'basic' then 1 else 0 end desc, s.expires_at desc, s.created_at desc
 LIMIT 1;
 RETURN coalesce(v_plan, 'free');
END
$function$;

CREATE OR REPLACE FUNCTION public.get_access_status(p_workspace_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $function$
DECLARE v_plan text; v_expires timestamptz;
BEGIN
 v_plan := public.current_plan(p_workspace_id);
 select max(s.expires_at) into v_expires
  from public.subscriptions s
  where s.workspace_id = p_workspace_id
    and s.status::text = 'active'
    and s.expires_at > clock_timestamp()
    and s.started_at <= clock_timestamp()
    and s.tier::text = v_plan;
 RETURN jsonb_build_object(
   'plan', v_plan,
   'expiresAt', v_expires,
   'startedAt', case when v_plan='free' then null else (select min(s.started_at) from public.subscriptions s where s.workspace_id=p_workspace_id and s.status::text='active' and s.expires_at > clock_timestamp() and s.tier::text = v_plan) end
 );
END
$function$;

-- Outcome A: the first historical duplicate migration body was applied.
\ir ../migrations/202611130004_converge_effective_subscription_priority.sql
DO $$ BEGIN
 IF position('CASE s.tier::text WHEN ''pro'' THEN 2' IN pg_get_functiondef('public.current_plan(text)'::regprocedure)) = 0 THEN
   RAISE EXCEPTION 'Outcome A current_plan was not converged';
 END IF;
 IF position('limit 1' IN lower(pg_get_functiondef('public.get_access_status(text)'::regprocedure))) = 0 THEN
   RAISE EXCEPTION 'Outcome A get_access_status was not converged';
 END IF;
END $$;

-- Runtime priority and expiry checks after convergence.
INSERT INTO public.workspaces VALUES ('A'), ('B');
INSERT INTO public.subscriptions(workspace_id,tier,status,started_at,expires_at)
VALUES
 ('A','pro','active',now()-interval '2 days',now()+interval '2 days'),
 ('A','basic','active',now()-interval '1 day',now()+interval '20 days'),
 ('B','pro','active',now()-interval '10 days',now()-interval '1 day'),
 ('B','basic','active',now()-interval '1 day',now()+interval '5 days');
DO $$ BEGIN
 IF public.current_plan('A') <> 'pro' THEN RAISE EXCEPTION 'Active Pro did not outrank longer Basic'; END IF;
 IF public.current_plan('B') <> 'basic' THEN RAISE EXCEPTION 'Expired Pro did not fall back to active Basic'; END IF;
 IF public.get_access_status('A')->>'plan' <> 'pro' THEN RAISE EXCEPTION 'Access status A plan mismatch'; END IF;
 IF public.get_access_status('B')->>'plan' <> 'basic' THEN RAISE EXCEPTION 'Access status B plan mismatch'; END IF;
END $$;

-- Outcome B: recreate the already-converged historical definition and re-run migration idempotently.
CREATE OR REPLACE FUNCTION public.current_plan(p_workspace_id text)
RETURNS text LANGUAGE plpgsql STABLE AS $function$
DECLARE v_plan text;
BEGIN
 SELECT s.tier INTO v_plan FROM public.subscriptions s
 WHERE s.workspace_id = p_workspace_id AND s.status::text = 'active'
   AND s.expires_at > clock_timestamp() AND s.started_at <= clock_timestamp()
 ORDER BY CASE s.tier::text WHEN 'pro' THEN 2 WHEN 'basic' THEN 1 ELSE 0 END DESC, s.expires_at desc, s.created_at desc
 LIMIT 1;
 RETURN coalesce(v_plan, 'free');
END
$function$;
CREATE OR REPLACE FUNCTION public.get_access_status(p_workspace_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $function$
DECLARE v_plan text; v_expires timestamptz;
BEGIN
 v_plan := public.current_plan(p_workspace_id);
 select s.expires_at into v_expires
  from public.subscriptions s
  where s.workspace_id = p_workspace_id
    and s.status::text = 'active'
    and s.expires_at > clock_timestamp()
    and s.started_at <= clock_timestamp()
    and s.tier::text in ('basic','pro')
  order by CASE s.tier::text WHEN 'pro' THEN 2 WHEN 'basic' THEN 1 ELSE 0 END DESC, s.expires_at desc, s.created_at desc
  limit 1;
 RETURN jsonb_build_object(
   'plan', v_plan,
   'expiresAt', v_expires,
   'startedAt', case when v_plan='free' then null else (select s.started_at from public.subscriptions s where s.workspace_id=p_workspace_id and s.status::text='active' and s.expires_at > clock_timestamp() and s.started_at <= clock_timestamp() and s.tier::text in ('basic','pro') order by CASE s.tier::text WHEN 'pro' THEN 2 WHEN 'basic' THEN 1 ELSE 0 END DESC, s.expires_at desc, s.created_at desc limit 1) end
 );
END
$function$;
\ir ../migrations/202611130004_converge_effective_subscription_priority.sql
DO $$ BEGIN
 IF public.current_plan('A') <> 'pro' OR public.current_plan('B') <> 'basic' THEN
   RAISE EXCEPTION 'Outcome B runtime priority regression';
 END IF;
END $$;

-- Tenant isolation: authenticated workspace A must not read workspace B subscriptions.
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY subscription_tenant_read ON public.subscriptions
 FOR SELECT TO authenticated
 USING (workspace_id = current_setting('request.jwt.claim.workspace_id', true));
GRANT USAGE ON SCHEMA public TO authenticated, anon, service_role;
GRANT SELECT ON public.subscriptions TO authenticated, anon, service_role;
SET request.jwt.claim.workspace_id = 'A';
SET ROLE authenticated;
DO $$ DECLARE n int; BEGIN SELECT count(*) INTO n FROM public.subscriptions; IF n <> 2 THEN RAISE EXCEPTION 'Workspace A saw % rows, expected 2',n; END IF; END $$;
RESET ROLE;
SET ROLE anon;
DO $$ DECLARE n int; BEGIN SELECT count(*) INTO n FROM public.subscriptions; IF n <> 0 THEN RAISE EXCEPTION 'Anonymous role saw subscription rows'; END IF; END $$;
RESET ROLE;
SET ROLE service_role;
DO $$ DECLARE n int; BEGIN SELECT count(*) INTO n FROM public.subscriptions; IF n <> 4 THEN RAISE EXCEPTION 'Service role saw % rows, expected 4',n; END IF; END $$;
RESET ROLE;
