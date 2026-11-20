import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("single workspace dashboard displays the selected country without an India-only identity", () => {
  const dashboard = read("../../pages/Dashboard.jsx");
  const backend = read("../../api/backendClient.js");
  assert.match(dashboard, /getCountryByCode\(user\?\.country_code\)/);
  assert.match(dashboard, /Workspace · \{getCountryByCode\(user\?\.country_code\)\?\.name \|\| "Choose country"\}/);
  assert.doesNotMatch(dashboard, /India Workspace/);
  assert.match(backend, /workspace_settings/);
  assert.match(backend, /workspaceSettings\?\.country_code/);
  assert.doesNotMatch(backend, /workspaceRegion\?\.country_code|profile\?\.country_code/);
});

test("legacy Global layout is isolated from the single Workspace label", () => {
  const layout = read("../../components/AppLayout.jsx");
  const global = read("../GlobalApp.jsx");
  assert.match(layout, /Workspace/);
  assert.doesNotMatch(layout, /Global Workspace/);
  assert.match(layout, /user\?\.workspace_name/);
  assert.match(layout, /user\?\.country_code/);
  assert.match(layout, /user\?\.currency_code/);
  assert.match(layout, /GLOBAL_NAV/);
  assert.match(global, /useNavigate/);
  assert.match(global, /export default function GlobalApp\(\{ section = "overview" \}\)/);
  assert.match(global, /TAB_PATHS/);
  assert.doesNotMatch(global, /<header className="border-b border-slate-200 bg-white">/);
});

test("unified invoice creation does not assume INR before canonical workspace currency loads", () => {
  const home = read("../../pages/Home.jsx");
  const stores = read("../../lib/stores.js");
  assert.match(home, /dueDate: "", currency: ""/);
  assert.match(home, /Choose and verify your Workspace country to see regional pricing/);
  assert.match(stores, /currency: r\.currency \|\| str\(r\.invoice_snapshot\?\.currency\)\.toUpperCase\(\) \|\| ""/);
  assert.doesNotMatch(stores, /currency: r\.currency \|\| "INR"/);
});

test("multi-currency invoice summaries group amounts by recorded currency without conversion", () => {
  const sales = read("../../components/dashboard/SalesTab.jsx");
  assert.match(sales, /const currencyTotals = \(records\) =>/);
  assert.match(sales, /money2\(amount, currency\)/);
  assert.match(sales, /const totalPaid = currencyTotals/);
  assert.match(sales, /const totalPending = currencyTotals/);
});

test("additional invoice currency selector is restricted to India Pro workspaces", () => {
  const home = read("../../pages/Home.jsx");
  assert.match(home, /activeWorkspaceCountry === "IN" && canAccess\("multi_currency"\)/);
  assert.match(home, /Invoices always use your Workspace's verified base currency/);
  assert.match(home, /Included on every plan/);
  assert.match(home, /data-testid="workspace-base-currency"/);
});

test("India tax reporting never mixes foreign-currency amounts or guesses FX for GSTR-1", () => {
  const tax = read("../../pages/TaxSummary.jsx");
  const gstr = read("../../lib/gstrExport.js");
  assert.match(tax, /taxByCurrency/);
  assert.match(tax, /Amounts are grouped by recorded invoice currency/);
  assert.match(tax, /Plivex will not guess an exchange rate/);
  assert.match(gstr, /invoiceCurrency !== "INR"/);
  assert.match(gstr, /foreign or missing currency cannot be converted automatically/);
});

test("profit analytics never adds foreign-currency sales to base-currency expenses", () => {
  const purchase = read("../../components/dashboard/PurchaseTab.jsx");
  const sales = read("../../components/dashboard/SalesTab.jsx");
  const crm = read("../../components/dashboard/CrmTab.jsx");
  assert.match(purchase, /salesByCurrency/);
  assert.match(purchase, /baseCurrencySales = salesByCurrency\.get\(currencyCode\)/);
  assert.match(purchase, /baseCurrencyExpenses = expensesByCurrency\.get\(currencyCode\)/);
  assert.match(purchase, /Net profit uses only base-currency sales and expenses; records without a recorded currency are excluded/);
  assert.match(purchase, /recordedExpenseAmount\(e\)/);
  assert.match(purchase, /Currency not recorded/);
  assert.match(purchase, /hasUnknownCurrencySales/);
  assert.doesNotMatch(purchase, /it\.currency \|\| currencyCode/);
  assert.match(sales, /const recordedCurrency =/);
  assert.match(sales, /This invoice has no recorded currency/);
  assert.match(sales, /Currency not recorded/);
  assert.doesNotMatch(sales, /record\.currency \|\| record\.currencyCode \|\| currencyCode/);
  assert.doesNotMatch(sales, /money2\(it\.total, it\.currency \|\| currencyCode\)/);
  assert.match(crm, /recordedLeadAmount\(l\)/);
  assert.doesNotMatch(crm, /money2\(l\.value, l\.currencyCode \|\| currencyCode\)/);
  assert.doesNotMatch(purchase, /money2\(e\.amount, e\.currencyCode \|\| currencyCode\)/);
  assert.match(purchase, /label="Monthly Sales" value=\{monthSales\}/);
  assert.doesNotMatch(purchase, /money2\(monthSales, currencyCode\)/);
});

test("business and client tax fields follow selected country rather than the India UI shell", () => {
  const business = read("../../pages/BusinessProfile.jsx");
  const clients = read("../../pages/ClientDatabase.jsx");
  assert.match(business, /isIndiaWorkspace = user\?\.country_code === "IN"/);
  assert.match(business, /lockCountry=\{isUnifiedBuild \|\| APP_EDITION === "global"\}/);
  assert.match(clients, /isIndiaWorkspace = user\?\.country_code === "IN"/);
  assert.match(clients, /countryExperience\?\.business\.registrationLabel/);
  assert.doesNotMatch(clients, /APP_EDITION === "global"/);
});

test("invoice history uses workspace locale and disables India-only reminders outside India", () => {
  const history = read("../../pages/InvoiceHistory.jsx");
  assert.match(history, /user\?\.country_code !== "IN" \|\| !view\?\.id/);
  assert.match(history, /dateLabel\(it\.issueDate, user\?\.locale_code\)/);
  assert.match(history, /money\(it\.total, it\.currency \|\| user\?\.currency_code\)/);
});

test("Workspace locale changes validate the selected country and update canonical settings", () => {
  const migration = read("../../../supabase/migrations/20261118121500_plivex_one_workspace_settings.sql");
  const handler = read("../../../supabase/functions/update-workspace-locale/index.ts");
  assert.match(migration, /update_workspace_locale_atomic/);
  assert.match(migration, /when 'US' then array\['en-US','es-US'\]/);
  assert.match(migration, /when 'GB' then array\['en-GB'\]/);
  assert.match(migration, /when 'AE' then array\['en-AE','ar-AE'\]/);
  assert.match(migration, /when 'CA' then array\['en-CA','fr-CA'\]/);
  assert.match(migration, /when 'AU' then array\['en-AU'\]/);
  assert.match(migration, /when 'SG' then array\['en-SG','zh-SG','ms-SG','ta-SG'\]/);
  assert.match(migration, /update public\.workspace_settings[\s\S]*set locale_code = p_locale_code/);
  assert.match(handler, /update_workspace_locale_atomic/);
  assert.doesNotMatch(handler, /en-IN.*hi-IN/);
});

test("save-invoice Edge Function bundles the exact shared tax engine sources", () => {
  const entry = read("../../../supabase/functions/save-invoice/index.ts");
  assert.match(entry, /\.\/\_shared\/tax\/invoice-tax-integration\.js/);
  const pairs = [
    ["../tax/invoice-tax-integration.js", "../../../supabase/functions/save-invoice/_shared/tax/invoice-tax-integration.js"],
    ["../tax/global-tax-engine.js", "../../../supabase/functions/save-invoice/_shared/tax/global-tax-engine.js"],
    ["../tax/global-invoice-finalization.js", "../../../supabase/functions/save-invoice/_shared/tax/global-invoice-finalization.js"],
    ["../tax/manual-tax-calculator.js", "../../../supabase/functions/save-invoice/_shared/tax/manual-tax-calculator.js"],
    ["../tax/tax-invoice-formats.js", "../../../supabase/functions/save-invoice/_shared/tax/tax-invoice-formats.js"],
    ["../tax/tax-treatment-policy.js", "../../../supabase/functions/save-invoice/_shared/tax/tax-treatment-policy.js"],
    ["../tax/verified-rule-evaluator.js", "../../../supabase/functions/save-invoice/_shared/tax/verified-rule-evaluator.js"],
    ["../tax/standard-rate-rules.js", "../../../supabase/functions/save-invoice/_shared/tax/standard-rate-rules.js"],
    ["../tax/tax-rule-registry.js", "../../../supabase/functions/save-invoice/_shared/tax/tax-rule-registry.js"],
    ["../money/currency-precision.js", "../../../supabase/functions/save-invoice/_shared/money/currency-precision.js"],
  ];
  for (const [sourcePath, bundlePath] of pairs) {
    const source = read(sourcePath);
    const bundle = read(bundlePath).replace(/^\/\/ Bundled copy for the save-invoice Edge Function\. Keep in sync with .+\n/, "");
    assert.equal(bundle, source, `Bundled tax module differs from ${sourcePath}`);
  }
});

test("historical monetary records retain their recorded legacy currency", () => {
  const migration = read("../../../supabase/migrations/20261118121500_plivex_one_workspace_settings.sql");
  const stores = read("../../lib/stores.js");
  assert.match(migration, /global\.user_profiles g[\s\S]*global\.workspaces w[\s\S]*w\.id = g\.default_workspace_id/);
  assert.match(migration, /case when p\.country_code = 'IN' then 'INR' end/);
  assert.match(migration, /update public\.expenses t[\s\S]*currency_code is null/);
  assert.match(migration, /update public\.stock t[\s\S]*currency_code is null/);
  assert.match(migration, /update public\.quotations t[\s\S]*currency_code is null/);
  assert.match(stores, /currencyCode: str\(r\.currency_code\)\.toUpperCase\(\)/);
});
