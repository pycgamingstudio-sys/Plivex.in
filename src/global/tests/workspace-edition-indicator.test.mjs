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
  assert.match(layout, /Global Workspace/);
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
  assert.match(home, /Additional invoice currencies are not available for this Workspace country yet/);
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
  assert.match(purchase, /salesByCurrency/);
  assert.match(purchase, /baseCurrencySales = salesByCurrency\.get\(currencyCode\)/);
  assert.match(purchase, /Net profit uses base-currency sales only; no FX conversion is performed/);
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
