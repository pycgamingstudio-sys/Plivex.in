import test from "node:test";
import assert from "node:assert/strict";
import { routeExpenseActionForWorkspace } from "./assistant-expense-workspace-routing.mjs";

const draft = { type: "create_expense", payload: { vendor: "Aman", amount: 50000, category: "Other", notes: "materials", date: "2026-11-27", method: "UPI" } };

test("routes deterministic expenses to the Global executor using workspace currency", () => {
  assert.deepEqual(routeExpenseActionForWorkspace(draft, { isGlobalWorkspace: true, currencyCode: "INR" }), {
    type: "create_global_expense",
    payload: { category: "Other", amount: 50000, currency_code: "INR", expense_date: "2026-11-27", vendor: "Aman", payment_method: "UPI", reference: "", notes: "materials" },
  });
});
test("preserves legacy expense actions outside Global workspaces", () => {
  assert.deepEqual(routeExpenseActionForWorkspace(draft, { isGlobalWorkspace: false }), draft);
});
test("rejects invalid Global amount or missing workspace currency", () => {
  assert.equal(routeExpenseActionForWorkspace({ ...draft, payload: { ...draft.payload, amount: 0 } }, { isGlobalWorkspace: true, currencyCode: "INR" }), null);
  assert.equal(routeExpenseActionForWorkspace(draft, { isGlobalWorkspace: true, currencyCode: "" }), null);
});
test("does not rewrite already-global expense actions", () => {
  const action = { type: "create_global_expense", payload: { category: "Other", amount: 50000, currency_code: "INR" } };
  assert.equal(routeExpenseActionForWorkspace(action, { isGlobalWorkspace: true, currencyCode: "INR" }), action);
});
