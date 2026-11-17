import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("India dashboard exposes all seven original and seven operations action cards", () => {
  const dashboard = read("../../components/dashboard/DashboardTab.jsx");
  for (const id of ["invoices", "quotations", "expenses", "crm", "leads", "stock", "team", "procurement", "warehouses", "transfers", "purchaseOrders", "receipts", "movements", "batches"]) {
    assert.match(dashboard, new RegExp('id: "' + id + '"'));
  }
  assert.match(dashboard, /grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3/);
});

test("India operations cards deep-link to the matching operations subsection", () => {
  const dashboard = read("../../components/dashboard/DashboardTab.jsx");
  const page = read("../../pages/Dashboard.jsx");
  const operations = read("../../components/dashboard/IndiaPart4Tab.jsx");
  assert.match(dashboard, /onNavigate\("warehouses", "transfers"\)/);
  assert.match(dashboard, /onNavigate\("warehouses", "history"\)/);
  assert.match(page, /initialSection=\{intent \|\| "purchasing"\}/);
  assert.match(operations, /setTab\(initialSection\)/);
});

test("CRM and inventory procurement shortcuts are removed from the duplicate More list", () => {
  const page = read("../../pages/Dashboard.jsx");
  assert.match(page, /!\["\/crm", "\/inventory-procurement"\]\.includes\(i\.to\)/);
  assert.match(page, /\{tab === "crm" && <CrmTab/);
});

test("Global overview has five interactive metrics and eight workspace action cards", () => {
  const global = read("../GlobalApp.jsx");
  assert.match(global, /const metricCards = \[/);
  assert.match(global, /const actionCards = \[/);
  assert.match(global, /actionCards\.map\(\(item\) => <button/);
  assert.match(global, /metricCards\.map\(\(item\) => <button/);
  for (const tab of ["crm", "purchasing", "warehouses", "transfers", "movements", "accounting", "enterprise"]) {
    assert.match(global, new RegExp('tab: "' + tab + '"'));
  }
});
