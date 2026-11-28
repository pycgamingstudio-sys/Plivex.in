import test from "node:test";
import assert from "node:assert/strict";
import { validateGlobalExpenseAction } from "./assistant-global-expense-validation.mjs";

const valid = {
  type: "create_global_expense",
  payload: { category: "Office supplies", amount: 125.5, currency_code: "USD", expense_date: "2026-11-19", vendor: "Yash Traders" },
};

test("validates required Global expense category, amount and workspace currency", () => {
  const result = validateGlobalExpenseAction(valid);
  assert.equal(result.payload.amount, 125.5);
  assert.equal(result.payload.currency_code, "USD");
  assert.equal(result.payload.category, "Office supplies");
  assert.equal(validateGlobalExpenseAction({ ...valid, payload: { ...valid.payload, category: " " } }), null);
  assert.equal(validateGlobalExpenseAction({ ...valid, payload: { ...valid.payload, amount: 0 } }), null);
  assert.equal(validateGlobalExpenseAction({ ...valid, payload: { ...valid.payload, currency_code: "XXX" } }), null);
});

test("accepts an omitted expense date for the database default but rejects invalid dates", () => {
  const payload = { ...valid.payload };
  delete payload.expense_date;
  assert.equal(validateGlobalExpenseAction({ type: "create_global_expense", payload }).payload.expense_date, null);
  assert.equal(validateGlobalExpenseAction({ ...valid, payload: { ...valid.payload, expense_date: "2026-02-30" } }), null);
});

test("bounds optional Global expense metadata", () => {
  const result = validateGlobalExpenseAction({
    ...valid,
    payload: { ...valid.payload, vendor: "v".repeat(250), payment_method: "p".repeat(100), reference: "r".repeat(200), notes: "n".repeat(5000) },
  });
  assert.equal(result.payload.vendor.length, 200);
  assert.equal(result.payload.payment_method.length, 80);
  assert.equal(result.payload.reference.length, 160);
  assert.equal(result.payload.notes.length, 4000);
});
