import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("India dashboard keeps core cards and one consolidated Inventory & Warehouse card", () => {
  const dashboard = read("../../components/dashboard/DashboardTab.jsx");
  for (const id of ["invoices", "quotations", "expenses", "crm", "leads", "stock", "team", "inventoryWorkspace"]) {
    assert.match(dashboard, new RegExp('id: "' + id + '"'));
  }
  for (const legacyId of ["procurement", "warehouses", "transfers", "purchaseOrders", "receipts", "movements", "batches"]) {
    assert.doesNotMatch(dashboard, new RegExp('id: "' + legacyId + '"'));
  }
  assert.match(dashboard, /title: "Inventory & Warehouse"/);
  assert.match(dashboard, /onClick: \(\) => onNavigate\("warehouses"\)/);
});

test("India inventory workspace opens one consolidated operations screen", () => {
  const dashboard = read("../../components/dashboard/DashboardTab.jsx");
  const page = read("../../pages/Dashboard.jsx");
  const operations = read("../../components/dashboard/IndiaPart4Tab.jsx");
  assert.match(dashboard, /onNavigate\("warehouses"\)/);
  assert.match(page, /tab === "warehouses" && <IndiaPart4Tab user=\{user\} \/>/);
  assert.match(operations, /useState\("warehouses"\)/);
  assert.match(operations, /\["warehouses","Stock & warehouses"/);
  assert.match(operations, /\["transfers","Transfers"/);
  assert.match(operations, /\["purchasing","Purchase orders"/);
  assert.match(operations, /\["history","Movement history"/);
});

test("CRM and inventory procurement shortcuts are removed from the duplicate More list", () => {
  const page = read("../../pages/Dashboard.jsx");
  assert.match(page, /!\["\/crm", "\/inventory-procurement"\]\.includes\(i\.to\)/);
  assert.match(page, /\{tab === "crm" && <CrmTab/);
});

test("Global overview has personalized interactive metrics and workspace action cards", () => {
  const global = read("../GlobalApp.jsx");
  const warehousePanel = read("../../components/global/GlobalPart4Panel.jsx");
  assert.match(global, /const metricCards = \[/);
  assert.match(global, /const actionCards = \[/);
  assert.match(global, /actionCards\.map\(\(item\) => <button/);
  assert.match(global, /visibleMetricCards\.map\(\(item\) => <button/);
  for (const title of ["CRM & Leads", "Inventory & Warehouse", "Accounting & Reports", "Team Members"]) {
    assert.ok(global.includes(`title: "${title}"`), `Missing dashboard card: ${title}`);
  }
  for (const section of ["warehouses", "transfers", "purchasing", "movements"]) {
    assert.match(warehousePanel, new RegExp('id: "' + section + '"'));
  }
  assert.doesNotMatch(global, /title: "Stock Transfers"/);
  assert.doesNotMatch(global, /title: "Purchase Orders & Goods Receipts"/);
});
