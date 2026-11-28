import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration=readFileSync(new URL("../../../supabase/migrations/20261128150000_main_workspace_accounting_reports.sql",import.meta.url),"utf8");
const panel=readFileSync(new URL("../../components/workspace/WorkspaceAccountingReports.jsx",import.meta.url),"utf8");
const bank=readFileSync(new URL("../../components/workspace/WorkspaceBankAccounting.jsx",import.meta.url),"utf8");

test("Main Workspace journal entries are restricted to the configured base currency",()=>{
  assert.match(migration,/select currency_code into v_base_currency from public\.workspace_settings/);
  assert.match(migration,/p_currency_code<>v_base_currency/);
  assert.match(migration,/reason','currency_mismatch/);
});

test("Trial balance is workspace-scoped, posted-only and reconciles debit and credit totals",()=>{
  assert.match(migration,/main_workspace_trial_balance/);
  assert.match(migration,/has_ws_role\(p_workspace_id/);
  assert.match(migration,/j\.status='posted'/);
  assert.match(migration,/debit_total/);
  assert.match(migration,/credit_total/);
  assert.match(migration,/abs\(v_debits-v_credits\)<0\.0001/);
});

test("General ledger reports opening and running balances in normal-balance direction",()=>{
  assert.match(migration,/main_workspace_general_ledger/);
  assert.match(migration,/v_account\.normal_balance='debit'/);
  assert.match(migration,/running_balance/);
  assert.match(migration,/j\.entry_date<p_from/);
});

test("Financial statements separate P&L and balance sheet and disclose balance check",()=>{
  assert.match(migration,/main_workspace_financial_statements/);
  assert.match(migration,/profit_loss/);
  assert.match(migration,/balance_sheet/);
  assert.match(migration,/current_period_profit/);
  assert.match(migration,/balance_check/);
  assert.match(migration,/grant execute on function public\.main_workspace_financial_statements/);
});

test("Accounting reports are integrated into the existing banking and journal workspace",()=>{
  assert.match(bank,/WorkspaceAccountingReports/);
  assert.match(panel,/main_workspace_trial_balance/);
  assert.match(panel,/main_workspace_financial_statements/);
  assert.match(panel,/main_workspace_general_ledger/);
  assert.match(panel,/Posted journals only/);
});

test("The journal UI cannot select a non-base currency",()=>{
  assert.match(bank,/Journals are recorded only in the Main Workspace base currency/);
  assert.match(bank,/<select className=\{field\} value=\{baseCurrency\} disabled>/);
  assert.doesNotMatch(bank,/\["INR","USD","GBP","AED","CAD","AUD","SGD"\]\.map/);
});

test("Journal and bank import UI reuse idempotency keys across retries",()=>{
  assert.match(bank,/journalKey/);
  assert.match(bank,/statementKey/);
  assert.match(bank,/p_idempotency_key:journalKey/);
  assert.match(bank,/p_idempotency_key:statementKey/);
});

test("Monthly close blocks journal creation and posting under the same advisory lock",()=>{
  const close=readFileSync(new URL("../../../supabase/migrations/20261128160000_main_workspace_accounting_period_close.sql",import.meta.url),"utf8");
  assert.match(close,/journal_entries_closed_period_guard/);
  assert.match(close,/before insert or update of entry_date,status on public\.journal_entries/);
  assert.match(close,/pg_advisory_xact_lock\(hashtextextended\(new\.workspace_id\|\|':'\|\|to_char\(v_period_start,'YYYY-MM'\),0\)\)/);
  assert.match(close,/unposted_journals_exist/);
  assert.match(close,/period_journal_totals_unbalanced/);
  assert.match(close,/main_workspace_close_accounting_period/);
  assert.match(close,/main_workspace_reopen_accounting_period/);
  assert.match(close,/has_ws_role\(p_workspace_id,array\['admin'::app_role\]\)/);
  assert.match(close,/accounting\.period\.reopened/);
});

test("Monthly close UI exposes administrator-only close and reopen actions",()=>{
  assert.match(bank,/Monthly accounting close/);
  assert.match(bank,/user\?\.role==="admin"&&/);
  assert.match(bank,/main_workspace_close_accounting_period/);
  assert.match(bank,/main_workspace_reopen_accounting_period/);
});
