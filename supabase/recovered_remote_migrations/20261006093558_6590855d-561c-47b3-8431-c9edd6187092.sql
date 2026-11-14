DROP TABLE IF EXISTS public.profiles CASCADE;

CREATE TYPE public.app_role AS ENUM ('admin','manager','employee','storekeeper','accountant');
CREATE TYPE public.member_status AS ENUM ('invited','accepted','active','removed');
CREATE TYPE public.invite_delivery AS ENUM ('not_required','pending','sent','failed');
CREATE TYPE public.log_outcome AS ENUM ('pending','applied','conflict');
CREATE TYPE public.plan_tier AS ENUM ('basic','pro');
CREATE TYPE public.subscription_status AS ENUM ('created','active','failed');
CREATE TYPE public.payment_outcome AS ENUM ('applied','failed','tampered');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  role public.app_role NOT NULL DEFAULT 'employee',
  workspace_id text,
  user_ref text,
  profile_picture text,
  trial_start_at timestamptz,
  trial_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (full_name, profile_picture) ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile read" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.current_workspace_id() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT workspace_id FROM public.profiles WHERE id = auth.uid() $$;
CREATE OR REPLACE FUNCTION public.current_is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') $$;
REVOKE EXECUTE ON FUNCTION public.current_workspace_id() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.current_is_admin() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.current_workspace_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_is_admin() TO authenticated, service_role;

CREATE TABLE public.workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_key text NOT NULL UNIQUE,
  workspace_id text NOT NULL,
  owner_id uuid NOT NULL,
  user_id uuid,
  name text,
  email text NOT NULL,
  role public.app_role NOT NULL DEFAULT 'employee',
  status public.member_status NOT NULL DEFAULT 'invited',
  revision integer NOT NULL DEFAULT 0,
  audit_event_key text,
  invited_at timestamptz,
  accepted_at timestamptz,
  activated_at timestamptz,
  removed_at timestamptz,
  invite_delivery public.invite_delivery NOT NULL DEFAULT 'not_required',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.workspace_members (workspace_id, owner_id);
CREATE INDEX ON public.workspace_members (user_id);
GRANT SELECT, INSERT, UPDATE ON public.workspace_members TO authenticated;
GRANT ALL ON public.workspace_members TO service_role;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read" ON public.workspace_members FOR SELECT TO authenticated
  USING (workspace_id = public.current_workspace_id() AND (owner_id = auth.uid() OR user_id = auth.uid()));
CREATE POLICY "members admin insert" ON public.workspace_members FOR INSERT TO authenticated
  WITH CHECK (public.current_is_admin() AND owner_id = auth.uid() AND workspace_id = public.current_workspace_id());
CREATE POLICY "members admin update" ON public.workspace_members FOR UPDATE TO authenticated
  USING (public.current_is_admin() AND owner_id = auth.uid() AND workspace_id = public.current_workspace_id())
  WITH CHECK (public.current_is_admin() AND owner_id = auth.uid() AND workspace_id = public.current_workspace_id());
CREATE TRIGGER workspace_members_updated_at BEFORE UPDATE ON public.workspace_members FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.invite_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  email text NOT NULL,
  role public.app_role NOT NULL,
  workspace_id text NOT NULL,
  owner_id uuid NOT NULL,
  membership_id uuid REFERENCES public.workspace_members(id) ON DELETE CASCADE,
  used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.invite_codes TO service_role;
ALTER TABLE public.invite_codes ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER invite_codes_updated_at BEFORE UPDATE ON public.invite_codes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL,
  workspace_id text,
  owner_id uuid,
  member_id uuid,
  actor_id uuid,
  action text NOT NULL,
  from_status text,
  to_status text,
  from_role text,
  to_role text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  outcome public.log_outcome NOT NULL DEFAULT 'pending',
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.activity_logs TO authenticated;
GRANT ALL ON public.activity_logs TO service_role;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "logs read owner or actor" ON public.activity_logs FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR actor_id = auth.uid());
CREATE TRIGGER activity_logs_updated_at BEFORE UPDATE ON public.activity_logs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  user_email text,
  workspace_id text,
  plan_id text NOT NULL,
  plan_name text,
  tier public.plan_tier NOT NULL,
  status public.subscription_status NOT NULL DEFAULT 'created',
  amount integer NOT NULL,
  currency text NOT NULL DEFAULT 'INR',
  gateway text NOT NULL DEFAULT 'payu',
  payu_txnid text UNIQUE,
  payu_payment_id text,
  started_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.subscriptions (user_id);
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own subscriptions read" ON public.subscriptions FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE TRIGGER subscriptions_updated_at BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.payment_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  user_email text,
  workspace_id text,
  gateway text NOT NULL DEFAULT 'payu',
  txnid text,
  payu_payment_id text,
  plan_id text,
  plan_name text,
  tier text,
  amount integer,
  currency text DEFAULT 'INR',
  gateway_status text,
  outcome public.payment_outcome NOT NULL,
  message text,
  source text,
  hash_verified boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.payment_logs TO authenticated;
GRANT ALL ON public.payment_logs TO service_role;
ALTER TABLE public.payment_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own payment logs read" ON public.payment_logs FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE TRIGGER payment_logs_updated_at BEFORE UPDATE ON public.payment_logs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.staff_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL DEFAULT auth.uid(),
  workspace_id text NOT NULL,
  name text,
  email text,
  role text,
  current_page text,
  last_ping_at timestamptz DEFAULT now(),
  today_date date DEFAULT current_date,
  today_invoices integer NOT NULL DEFAULT 0,
  today_quotations integer NOT NULL DEFAULT 0,
  today_revenue numeric NOT NULL DEFAULT 0,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_activity TO authenticated;
GRANT ALL ON public.staff_activity TO service_role;
ALTER TABLE public.staff_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read same workspace" ON public.staff_activity FOR SELECT TO authenticated
  USING (workspace_id = public.current_workspace_id());
CREATE POLICY "staff insert creator" ON public.staff_activity FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND workspace_id = public.current_workspace_id());
CREATE POLICY "staff update creator" ON public.staff_activity FOR UPDATE TO authenticated
  USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid() AND workspace_id = public.current_workspace_id());
CREATE POLICY "staff delete creator" ON public.staff_activity FOR DELETE TO authenticated USING (created_by = auth.uid());
CREATE TRIGGER staff_activity_updated_at BEFORE UPDATE ON public.staff_activity FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
