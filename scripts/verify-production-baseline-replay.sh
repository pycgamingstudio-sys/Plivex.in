#!/usr/bin/env bash
set -euo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=postgres}"
export PGHOST PGPORT PGUSER PGDATABASE

psql_cmd=(psql -X -v ON_ERROR_STOP=1 -d "$PGDATABASE")
query() { "${psql_cmd[@]}" -A -t -c "$1" | tr -d '\r'; }
fail() { echo "FAIL: $*" >&2; exit 1; }

# These are the exact pending Parts 1-8 migrations identified against the
# current production ledger. Migrations already represented in production
# (including the Global foundation, country reset, inventory RPC and invoice
# payment ledger) are intentionally excluded. Part 9 is intentionally absent.
migrations=(
  202611130003_invoice_share_rate_limit.sql
  202611130004_converge_effective_subscription_priority.sql
  202611130006_workspace_country_identity.sql
  202611130007_global_billing_and_cashfree_atomicity.sql
  202611130008_cashfree_refund_atomicity.sql
  202611130009_global_billing_concurrency_and_definer_hardening.sql
  202611130010_cashfree_refund_identity_immutability.sql
  20261114000002_global_workspace_tax_registration_profile.sql
  20261114000003_global_invoice_tax_calculation.sql
  20261114000004_global_tax_snapshot_hardening.sql
  20261114000005_cashfree_refund_exact_payment_mapping.sql
  202611150009_safe_workspace_country_migration_requests.sql
  202611150010_harden_country_migration_request_rls.sql
  202611150011_global_invoice_issuance_and_refunds.sql
  202611160001_global_part4_crm_warehouse_procurement.sql
  202611160002_global_part4_transactional_operations.sql
  202611160003_india_part4_warehouse_crm_purchase.sql
  202611160004_india_part4_transactional_rpcs.sql
  202611160005_india_invoice_stock_atomicity.sql
  202611160006_global_invoice_stock_atomicity.sql
  20261116100000_global_accounting_double_entry.sql
  20261116110000_global_accounting_part3b_fx_purchases_refunds.sql
  20261116120000_global_enterprise_controls.sql
  20261116121000_global_tax_audit_and_publication.sql
  20261116122000_global_multicurrency_expenses.sql
  20261116123000_global_enterprise_hardening.sql
)

for migration in "${migrations[@]}"; do
  test -s "supabase/migrations/$migration" || fail "Missing migration file: $migration"
done

# Require the restored database to contain the production baseline before
# testing forward migrations. This is a schema/data restore, not an empty DB.
baseline_missing="$(query "
SELECT string_agg(x.name, ',')
FROM (VALUES
 ('public.profiles'),('public.subscriptions'),('public.payment_logs'),
 ('public.invoices'),('public.invoice_items'),('global.workspaces'),
 ('global.workspace_members'),('global.clients'),('global.products'),
 ('global.stock_levels'),('global.stock_movements'),('global.invoices'),
 ('global.expenses')
) AS x(name)
WHERE to_regclass(x.name) IS NULL;
")"
test -z "$baseline_missing" || fail "Production baseline restore is missing tables: $baseline_missing"

before_india="$(query "
SELECT concat_ws('|',
 (SELECT count(*) FROM public.profiles),
 (SELECT count(*) FROM public.subscriptions),
 (SELECT count(*) FROM public.payment_logs),
 (SELECT count(*) FROM public.invoices),
 (SELECT count(*) FROM public.invoice_items)
);
")"
before_global="$(query "
SELECT concat_ws('|',
 (SELECT count(*) FROM global.workspaces),
 (SELECT count(*) FROM global.workspace_members),
 (SELECT count(*) FROM global.clients),
 (SELECT count(*) FROM global.products),
 (SELECT count(*) FROM global.invoices),
 (SELECT count(*) FROM global.expenses)
);
")"

for migration in "${migrations[@]}"; do
  echo "APPLY production-baseline candidate: $migration"
  "${psql_cmd[@]}" -f "supabase/migrations/$migration"
done

after_india="$(query "
SELECT concat_ws('|',
 (SELECT count(*) FROM public.profiles),
 (SELECT count(*) FROM public.subscriptions),
 (SELECT count(*) FROM public.payment_logs),
 (SELECT count(*) FROM public.invoices),
 (SELECT count(*) FROM public.invoice_items)
);
")"
after_global="$(query "
SELECT concat_ws('|',
 (SELECT count(*) FROM global.workspaces),
 (SELECT count(*) FROM global.workspace_members),
 (SELECT count(*) FROM global.clients),
 (SELECT count(*) FROM global.products),
 (SELECT count(*) FROM global.invoices),
 (SELECT count(*) FROM global.expenses)
);
")"
test "$before_india" = "$after_india" || fail "India core row counts changed during migration replay: before=$before_india after=$after_india"
test "$before_global" = "$after_global" || fail "Existing Global business row counts changed during migration replay: before=$before_global after=$after_global"

missing_after="$(query "
SELECT string_agg(x.name, ',')
FROM (VALUES
 ('global.accounting_accounts'),('global.journal_entries'),('global.journal_entry_lines'),
 ('global.purchase_bills'),('global.stock_transfers'),('global.invoice_refunds'),
 ('global.exchange_rate_snapshots'),('global.tax_rule_versions'),
 ('global.tax_calculation_audit'),('global.approval_requests'),('global.export_jobs'),
 ('global.audit_events'),('global.workspace_branches'),('public.stock_transfers'),
 ('public.workspace_country_change_requests'),('public.invoice_share_rate_limits')
) AS x(name)
WHERE to_regclass(x.name) IS NULL;
")"
test -z "$missing_after" || fail "Pending Parts 1-8 migrations did not create required tables: $missing_after"

unprotected="$(query "
SELECT string_agg(x.name, ',')
FROM (VALUES
 ('global.accounting_accounts'),('global.journal_entries'),('global.journal_entry_lines'),
 ('global.purchase_bills'),('global.stock_transfers'),('global.invoice_refunds'),
 ('global.exchange_rate_snapshots'),('global.tax_rule_versions'),
 ('global.tax_calculation_audit'),('global.approval_requests'),('global.export_jobs'),
 ('global.audit_events'),('global.workspace_branches'),('public.stock_transfers'),
 ('public.workspace_country_change_requests'),('public.invoice_share_rate_limits')
) AS x(name)
WHERE NOT COALESCE((SELECT c.relrowsecurity FROM pg_class c WHERE c.oid=to_regclass(x.name)),false);
")"
test -z "$unprotected" || fail "New application tables without RLS: $unprotected"

missing_rpcs="$(query "
SELECT string_agg(x.signature, ',')
FROM (VALUES
 ('public.apply_cashfree_subscription_payment(uuid,text,text,bigint,text,text,jsonb,text)'),
 ('public.apply_cashfree_refund_event(uuid,text,text,text,bigint,text,text,jsonb)'),
 ('public.global_record_stock_movement(uuid,uuid,uuid,text,numeric,text,uuid)'),
 ('public.global_create_invoice_draft(uuid,uuid,uuid,text,date,date,text,jsonb,uuid)'),
 ('public.global_create_expense_with_fx(uuid,uuid,text,text,bigint,text,date,uuid,numeric,numeric,text,text,timestamp with time zone,text)'),
 ('public.global_publish_tax_rule_version(uuid,text)'),
 ('public.global_append_tax_calculation_audit(uuid,uuid,uuid,integer,jsonb)'),
 ('public.global_can_export(uuid,uuid,text)'),
 ('public.global_cancel_approval_request(uuid,uuid,uuid)')
) AS x(signature)
WHERE to_regprocedure(x.signature) IS NULL;
")"
test -z "$missing_rpcs" || fail "Required Parts 1-8 RPCs missing after replay: $missing_rpcs"

echo "PASS: 26 pending Parts 1-8 migrations replayed on restored production baseline."
echo "PASS: India and existing Global core row counts preserved."
echo "PASS: required accounting, inventory, procurement, tax, refund and enterprise tables have RLS."
echo "PASS: required payment, invoice, FX, tax and enterprise RPCs exist."
echo "India row counts: $after_india"
echo "Global row counts: $after_global"
