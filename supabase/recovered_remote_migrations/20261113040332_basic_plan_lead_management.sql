-- Move the standard lead pipeline from Pro to Basic.
-- Basic workspaces receive up to 200 leads; Free remains locked and Pro keeps its larger quota.
insert into public.plan_features (plan, feature, allowed)
values ('basic', 'lead_pipeline', true)
on conflict (plan, feature) do update set allowed = excluded.allowed;

update public.plan_limits
set max_count = 200, period = 'total'
where plan = 'basic' and resource = 'leads';

-- Ensure the Basic lead quota exists even if the row was missing.
insert into public.plan_limits (plan, resource, max_count, period)
values ('basic', 'leads', 200, 'total')
on conflict (plan, resource) do update
set max_count = excluded.max_count, period = excluded.period;
