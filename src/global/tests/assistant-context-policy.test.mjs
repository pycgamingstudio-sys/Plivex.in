import test from "node:test";
import assert from "node:assert/strict";
import { getLiveContextQueryPlan } from "../../../supabase/functions/assistant-chat/_shared/assistant-context-query-plan.mjs";
import { getAssistantRequestPolicy } from "../../../supabase/functions/assistant-chat/_shared/assistant-request-policy.mjs";

test("simple conversation does not query unrelated workspace modules", () => {
  const plan = getLiveContextQueryPlan("Hi, how are you?");
  assert.equal(Object.values(plan).some(Boolean), false);
});

test("inventory request loads inventory and purchasing context only", () => {
  const plan = getLiveContextQueryPlan("Show current stock in my warehouse");
  assert.equal(plan.stock, true);
  assert.equal(plan.inventory, true);
  assert.equal(plan.invoices, false);
  assert.equal(plan.expenses, false);
  assert.equal(plan.quotations, false);
});

test("finance request loads invoice and expense context", () => {
  const plan = getLiveContextQueryPlan("Show monthly sales and profit");
  assert.equal(plan.invoices, true);
  assert.equal(plan.expenses, true);
  assert.equal(plan.businessProfile, true);
});

test("global workspace identity alone does not force a data fetch", () => {
  const policy = getAssistantRequestPolicy({ isGlobalWorkspace: true });
  assert.equal(policy.loadGlobalContext, false);
  assert.equal(policy.simpleConversationalTurn, true);
  assert.equal(policy.thinkingLevel, "low");
});

test("business data requests opt into the minimum required global context", () => {
  const policy = getAssistantRequestPolicy({
    isGlobalWorkspace: true,
    needsGlobalClientContext: true,
  });
  assert.equal(policy.loadGlobalContext, true);
  assert.equal(policy.needsGlobalContext, true);
  assert.equal(policy.simpleConversationalTurn, false);
});
