import test from "node:test";
import assert from "node:assert/strict";
import { validateGlobalProductAction } from "./assistant-global-product-validation.mjs";

const valid = {
  type: "create_global_product",
  payload: { name: "Coffee beans", sku: "COF-001", unit: "kg", currency_code: "USD", sale_price: 12.5, purchase_cost: 8.25, tax_code: "STANDARD" },
};

test("validates Global product master and converts optional commercial fields", () => {
  const result = validateGlobalProductAction(valid);
  assert.equal(result.payload.name, "Coffee beans");
  assert.equal(result.payload.unit, "kg");
  assert.equal(result.payload.sale_price, 12.5);
  assert.equal(result.payload.purchase_cost, 8.25);
  assert.equal(validateGlobalProductAction({ ...valid, payload: { ...valid.payload, name: " " } }), null);
  assert.equal(validateGlobalProductAction({ ...valid, payload: { ...valid.payload, currency_code: "XXX" } }), null);
  assert.equal(validateGlobalProductAction({ ...valid, payload: { ...valid.payload, sale_price: -1 } }), null);
});

test("supports zero prices and safe defaults without creating stock quantity", () => {
  const result = validateGlobalProductAction({ type: "create_global_product", payload: { name: "Free sample", currency_code: "JPY", sale_price: 0 } });
  assert.equal(result.payload.sale_price, 0);
  assert.equal(result.payload.unit, "unit");
  assert.equal(result.payload.is_active, true);
});

test("bounds SKU and product descriptions", () => {
  const result = validateGlobalProductAction({
    ...valid, payload: { ...valid.payload, sku: "s".repeat(100), description: "d".repeat(5000), tax_code: "t".repeat(100) },
  });
  assert.equal(result.payload.sku.length, 80);
  assert.equal(result.payload.description.length, 4000);
  assert.equal(result.payload.tax_code.length, 64);
});
