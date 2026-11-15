CREATE TABLE public.assistant_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL,
  user_id uuid NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled','expired','failed')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  confirmed_at timestamptz
);
GRANT SELECT ON public.assistant_actions TO authenticated;
GRANT ALL ON public.assistant_actions TO service_role;
ALTER TABLE public.assistant_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own assistant actions" ON public.assistant_actions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX assistant_actions_user_idx ON public.assistant_actions (user_id, created_at DESC);

CREATE TABLE public.assistant_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.assistant_usage TO service_role;
ALTER TABLE public.assistant_usage ENABLE ROW LEVEL SECURITY;
CREATE INDEX assistant_usage_user_idx ON public.assistant_usage (user_id, created_at DESC);
