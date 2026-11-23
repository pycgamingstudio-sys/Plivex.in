import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const globalApp = readFileSync(new URL("../GlobalApp.jsx", import.meta.url), "utf8");
const warehousePanel = readFileSync(new URL("../../components/global/GlobalPart4Panel.jsx", import.meta.url), "utf8");
const indiaWarehousePanel = readFileSync(new URL("../../components/dashboard/IndiaPart4Tab.jsx", import.meta.url), "utf8");
const indiaDashboard = readFileSync(new URL("../../pages/Dashboard.jsx", import.meta.url), "utf8");
const indiaDashboardCards = readFileSync(new URL("../../components/dashboard/DashboardTab.jsx", import.meta.url), "utf8");
const navigation = globalApp.match(/const NAV = \[([\s\S]*?)\];/)?.[1] || "";

test("inventory and warehouse are represented by one top-level workspace", () => {
  assert.equal((navigation.match(/id: "inventory"/g) || []).length, 1);
  assert.match(navigation, /id: "inventory", label: "Inventory & Warehouse"/);
  for (const legacySection of ["warehouses", "transfers", "purchasing", "movements"]) {
    assert.doesNotMatch(navigation, new RegExp(`id: "${legacySection}"`));
  }
});

test("the unified inventory entry opens the existing warehouse workflow adapter", () => {
  assert.match(globalApp, /\["crm", "inventory", "sales_docs", "suppliers"\]\.includes\(tab\)/);
  assert.match(globalApp, /initialSection=\{tab === "crm" \? "crm" : tab === "sales_docs" \? "sales_docs" : tab === "suppliers" \? "suppliers" : "warehouses"\}/);
  assert.match(warehousePanel, /initialSection = "crm"/);
  assert.match(warehousePanel, /setSection\(initialSection\)/);
  assert.match(globalApp, /\["crm", "inventory", "quotations", "suppliers"\]\.includes\(activeTab\)/);
});

test("warehouse operations use compact in-page tabs rather than destination cards", () => {
  assert.match(warehousePanel, /aria-label="Inventory workspace sections"/);
  assert.match(warehousePanel, /Stock & warehouses/);
  assert.match(warehousePanel, /Transfers/);
  assert.match(warehousePanel, /Purchase orders/);
  assert.match(warehousePanel, /Movement history/);
  assert.doesNotMatch(warehousePanel, /data\.warehouses\.map\(\(w\)=><div/);
});

test("warehouse and procurement forms are opened on demand", () => {
  for (const state of ["showWarehouseForm", "showTransferForm", "showOrderForm", "showReceiptForm"]) {
    assert.match(warehousePanel, new RegExp(state));
  }
  assert.match(warehousePanel, /New transfer/);
  assert.match(warehousePanel, /New purchase order/);
});

test("existing server-side operations remain wired to their original actions", () => {
  for (const operation of ["create_warehouse", "transfer", "create_purchase_order", "receive_purchase_order"]) {
    assert.ok(warehousePanel.includes(operation), `Missing operation: ${operation}`);
  }
});

test("movement history has search, type and date filters", () => {
  assert.match(warehousePanel, /movementQuery/);
  assert.match(warehousePanel, /movementType/);
  assert.match(warehousePanel, /movementFrom/);
  assert.match(warehousePanel, /movementTo/);
  assert.match(warehousePanel, /filteredMovements/);
});

test("India warehouse uses the same compact in-page operations workspace", () => {
  assert.match(indiaWarehousePanel, /aria-label="Inventory workspace sections"/);
  assert.match(indiaWarehousePanel, /useState\("warehouses"\)/);
  assert.match(indiaDashboardCards, /title: "Inventory & Warehouse"/);
  assert.match(indiaWarehousePanel, /Stock & warehouses/);
  assert.match(indiaWarehousePanel, /Purchase orders/);
  assert.match(indiaWarehousePanel, /Movement history/);
  assert.doesNotMatch(indiaWarehousePanel, /warehouses\.map\(w=><div/);
});

test("India warehouse actions remain collapsed and preserve transactional RPCs", () => {
  for (const state of ["showWarehouseForm", "showOrderForm", "showReceiptForm", "showTransferForm"]) {
    assert.match(indiaWarehousePanel, new RegExp(state));
  }
  for (const operation of ["india_part4_create_purchase_order", "india_part4_receive_purchase_order", "india_part4_transfer_stock"]) {
    assert.ok(indiaWarehousePanel.includes(operation), `Missing operation: ${operation}`);
  }
});

test("India movement history supports search, type and date filters", () => {
  for (const filter of ["movementQuery", "movementType", "movementFrom", "movementTo", "filteredMovements"]) {
    assert.ok(indiaWarehousePanel.includes(filter), `Missing movement filter: ${filter}`);
  }
});

test("dashboard keeps its other premium cards but consolidates warehouse shortcuts", () => {
  assert.match(globalApp, /title: "CRM & Leads"/);
  assert.match(globalApp, /title: "Inventory & Warehouse"/);
  assert.match(globalApp, /title: "Accounting & Reports"/);
  assert.match(globalApp, /title: "Team Members"/);
  assert.doesNotMatch(globalApp, /title: "Enterprise & Audit"/);
  assert.doesNotMatch(globalApp, /title: "Stock Transfers"/);
  assert.doesNotMatch(globalApp, /title: "Purchase Orders & Goods Receipts"/);
  assert.match(globalApp, /\{actionCards\.length\} work areas/);
});
