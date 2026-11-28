import test from "node:test";
import assert from "node:assert/strict";
import { getLiveContextQueryPlan } from "./assistant-context-query-plan.mjs";

test("ordinary conversation does not request workspace tables", () => {
  const plan = getLiveContextQueryPlan("Hello, how are you?");
  assert.deepEqual(Object.values(plan).filter(Boolean), []);
});

test("business performance loads finance-relevant records but not purchasing history", () => {
  const plan = getLiveContextQueryPlan("Review my sales, expenses, profit and cash flow");
  assert.equal(plan.invoices, true);
  assert.equal(plan.expenses, true);
  assert.equal(plan.businessProfile, true);
  assert.equal(plan.purchasing, false);
  assert.equal(plan.inventory, false);
  assert.equal(plan.quotations, false);
});

test("inventory question loads inventory and warehouse-related context only", () => {
  const plan = getLiveContextQueryPlan("Show my stock and low stock products");
  assert.equal(plan.stock, true);
  assert.equal(plan.inventory, true);
  assert.equal(plan.purchasing, false);
  assert.equal(plan.expenses, false);
  assert.equal(plan.leads, false);
});

test("purchase receiving requests load purchasing and inventory context", () => {
  const plan = getLiveContextQueryPlan("Receive this purchase order into my warehouse");
  assert.equal(plan.purchasing, true);
  assert.equal(plan.inventory, true);
  assert.equal(plan.stock, true);
});

test("Hindi/Hinglish client and expense requests are routed to the correct tables", () => {
  const clientPlan = getLiveContextQueryPlan("Mere grahak ki details dikhao");
  assert.equal(clientPlan.clients, true);
  const expensePlan = getLiveContextQueryPlan("Mere kharche kitne hain?");
  assert.equal(expensePlan.expenses, true);
});

test("invoice creation can access client, stock, service and business details", () => {
  const plan = getLiveContextQueryPlan("Create a new invoice for this customer");
  assert.equal(plan.invoices, true);
  assert.equal(plan.stock, true);
  assert.equal(plan.services, true);
  assert.equal(plan.businessProfile, true);
});
