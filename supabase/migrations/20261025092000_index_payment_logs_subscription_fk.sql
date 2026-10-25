-- Index the foreign key used to join payment logs to subscriptions.
CREATE INDEX IF NOT EXISTS payment_logs_subscription_id_idx ON public.payment_logs (subscription_id);
