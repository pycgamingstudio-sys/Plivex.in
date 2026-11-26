import test from "node:test";
import assert from "node:assert/strict";
import { validateWarehouseAction } from "./assistant-warehouse-validation.mjs";

test("normalizes a warehouse with optional code and address", () => {
  const result = validateWarehouseAction({ type: "create_warehouse", payload: { name: "North Godown", code: "NORTH-01", address: "Sector 4" } });
  assert.deepEqual(result.payload, { name: "North Godown", code: "NORTH-01", address: "Sector 4" });
});

test("allows server-generated warehouse code when the user only gives a name", () => {
  const result = validateWarehouseAction({ type: "create_warehouse", payload: { name: "New Godown" } });
  assert.equal(result.payload.code, null);
});

test("rejects empty names and invalid codes", () => {
  assert.equal(validateWarehouseAction({ type: "create_warehouse", payload: { name: " " } }), null);
  assert.equal(validateWarehouseAction({ type: "create_warehouse", payload: { name: "North", code: "bad code" } }), null);
  assert.equal(validateWarehouseAction({ type: "create_warehouse", payload: { name: "North", code: "x".repeat(33) } }), null);
  assert.equal(validateWarehouseAction({ type: "create_warehouse", payload: { name: "N".repeat(161) } }), null);
});

test("does not accept a different action type", () => {
  assert.equal(validateWarehouseAction({ type: "create_stock", payload: { name: "North" } }), null);
});
