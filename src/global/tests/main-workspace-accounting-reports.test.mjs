import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../../../supabase/migrations/20261128120000_main_workspace_accounting_reports.sql", import.meta.url), "utf8");
const books = readFileSync(new URL("../../components/dashboard/BooksTab.jsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../../pages/Dashboard.jsx", import.meta.url), "utf8");
const roles = readFileSync(new URL("../../lib/roles.js", import.meta.url), "utf8");
const app = readFileSync(new URL("../../App.jsx", import.meta.url), "utf8");
const homeGate = readFileSync(new URL("../../components/HomeGate.jsx", import.meta.url), "utf8");
const assistant = readFileSync(new URL("../../components/AssistantWidget.jsx", import.meta.url), "utf8");

test("Main Workspace accounting reports are authenticated, role-scoped and read posted entries only", () => {
  assert.match(migration, /create or replace function public\.main_workspace_accounting_summary/);
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /public\.has_ws_role\([\s\S]*'admin'::app_role,'manager'::app_role,'accountant'::app_role/);
  assert.match(migration, /j\.status='posted'/);
  assert.match(migration, /j\.entry_date<=p_to/);
  assert.match(migration, /j\.entry_date between p_from and p_to/);
  assert.match(migration, /group by j\.currency_code/);
  assert.match(migration, /balance_difference/);
  assert.match(migration, /revoke all on function public\.main_workspace_accounting_summary\(text,date,date\) from public,anon/);
  assert.match(migration, /grant execute on function public\.main_workspace_accounting_summary\(text,date,date\) to authenticated/);
});

test("Books UI uses the protected Main Workspace accounting RPCs rather than direct table access", () => {
  assert.match(books, /main_workspace_list_bank_data/);
  assert.match(books, /main_workspace_list_journal_entries/);
  assert.match(books, /main_workspace_accounting_summary/);
  assert.match(books, /main_workspace_create_journal_entry/);
  assert.match(books, /main_workspace_post_journal_entry/);
  assert.match(books, /p_idempotency_key: requestKeyRef\.current/);
  assert.match(books, /totals\.debit === totals\.credit/);
  assert.doesNotMatch(books, /supabase\.from\(["'](?:accounting_accounts|journal_entries|journal_entry_lines)["']\)/);
});

test("Books and AI tabs respect workspace roles and preserve the existing assistant", () => {
  assert.match(roles, /admin: \["dashboard", "sales", "purchase", "books", "ai"/);
  assert.match(roles, /manager: \["dashboard", "sales", "purchase", "books", "ai"/);
  assert.match(roles, /accountant: \["dashboard", "sales", "purchase", "books", "ai"/);
  assert.match(dashboard, /import BooksTab from "@\/components\/dashboard\/BooksTab"/);
  assert.match(dashboard, /tab === "books" && <BooksTab \/>/);
  assert.match(dashboard, /<AssistantWidget openOnMount=\{tab === "ai"\} \/>/);
  assert.match(assistant, /openOnMount = false/);
});

test("Books and AI have stable Main Workspace routes and the mobile bar exposes Home, Sales, Books, AI and More", () => {
  assert.match(app, /path="\/workspace\/books"/);
  assert.match(app, /path="\/workspace\/ai"/);
  assert.match(app, /path="\/workspace\/more"/);
  assert.match(app, /path="\/accounting" element=\{<Navigate to="\/workspace\/books"/);
  for (const label of ["Home", "Sales", "Books", "AI", "More"]) {
    assert.match(homeGate, new RegExp('label: "' + label + '"'));
  }
});
