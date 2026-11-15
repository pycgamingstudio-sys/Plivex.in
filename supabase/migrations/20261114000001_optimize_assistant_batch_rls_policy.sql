-- Avoid per-row auth.uid() evaluation in the assistant batch read policy.
-- Preserve the existing authenticated-only policy and its row-ownership predicate.
ALTER POLICY "Users read own assistant action batches"
  ON public.assistant_action_batches
  USING (user_id = (SELECT auth.uid()));
