import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateStockTransferAction as validateChatTransfer } from "../../../supabase/functions/assistant-chat/_shared/assistant-warehouse-validation.mjs";
import { validateStockTransferAction as validateConfirmTransfer } from "../../../supabase/functions/assistant-confirm/_shared/assistant-warehouse-validation.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const registry = read("../../../supabase/functions/assistant-chat/_shared/assistant-tool-registry.mjs");
const chat = read("../../../supabase/functions/assistant-chat/source/index.ts");
const confirm = read("../../../supabase/functions/assistant-confirm/source/index.ts");

const validAction = {
  type: "stock_transfer",
  payload: {
    stock_id: "11111111-1111-4111-8111-111111111111",
    to_warehouse_id: "22222222-2222-4222-8222-222222222222",
    quantity: 12.3456,
    stock_name: "Sugar",
    destination_name: "North Warehouse",
  },
};

test("Nova accepts only valid workspace stock-transfer identifiers and four-decimal quantities", () => {
  assert.deepEqual(validateChatTransfer(validAction), validateConfirmTransfer(validAction));
  assert.equal(validateChatTransfer(validAction).payload.quantity, 12.3456);
  assert.equal(validateChatTransfer({ ...validAction, payload: { ...validAction.payload, stock_id: "not-a-uuid" } }), null);
  assert.equal(validateChatTransfer({ ...validAction, payload: { ...validAction.payload, quantity: 0 } }), null);
  assert.equal(validateChatTransfer({ ...validAction, payload: { ...validAction.payload, quantity: 1.00001 } }), null);
});

test("stock transfer is an allow-listed, user-confirmed Nova write tool", () => {
  assert.match(registry, /stock_transfer: \{ module: "stock_transfers", approval: "user_confirmation"/);
  assert.match(registry, /stock_transfers: \{ readContext: true, writeTools: \["stock_transfer"\], planned: false \}/);
  assert.match(chat, /validateStockTransferAction/);
  assert.match(chat, /summary: "Transfer "/);
  assert.match(chat, /" units of "/);
});

test("Nova confirms stock transfer through the existing atomic RPC and verifies both ledger movements", () => {
  assert.match(confirm, /india_part4_transfer_stock/);
  assert.match(confirm, /p_stock_id: payload\.stock_id/);
  assert.match(confirm, /p_to_warehouse_id: payload\.to_warehouse_id/);
  assert.match(confirm, /p_idempotency_key: idempotencyKey/);
  assert.match(confirm, /transfer_out/);
  assert.match(confirm, /transfer_in/);
  assert.match(confirm, /movements\.length === 2/);
});
