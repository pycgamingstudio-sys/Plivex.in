import test from "node:test";
import assert from "node:assert/strict";
import { buildBusinessIntentHints, classifyBusinessIntents, parseBusinessAmount, parseBusinessQuantity } from "./assistant-intent-planner.mjs";

test("parses Indian and abbreviated amounts without guessing malformed values", () => {
  assert.equal(parseBusinessAmount("₹50,000"), 50000);
  assert.equal(parseBusinessAmount("1.5 lakh"), 150000);
  assert.equal(parseBusinessAmount("50k"), 50000);
  assert.equal(parseBusinessAmount("₹12,34,567"), 1234567);
  assert.equal(parseBusinessAmount("about fifty thousand"), null);
});

test("normalizes quantity units used in Indian inventory requests", () => {
  assert.deepEqual(parseBusinessQuantity("50 kilo chini"), { quantity: 50, unit: "kg" });
  assert.deepEqual(parseBusinessQuantity("2 litres oil"), { quantity: 2, unit: "litre" });
  assert.deepEqual(parseBusinessQuantity("12 packets"), { quantity: 12, unit: "packet" });
  assert.equal(parseBusinessQuantity("zero kg"), null);
});

test("separates product creation from purchase orders and stock receipts", () => {
  assert.deepEqual(classifyBusinessIntents("add product sugar"), ["create_stock"]);
  assert.deepEqual(classifyBusinessIntents("create purchase order for sugar"), ["create_purchase_order"]);
  assert.deepEqual(classifyBusinessIntents("stock received at godown"), ["receive_stock"]);
});

test("recognizes incoming and outgoing payments as different intents", () => {
  assert.deepEqual(classifyBusinessIntents("customer payment received"), ["payment_incoming"]);
  assert.deepEqual(classifyBusinessIntents("paid to supplier"), ["payment_outgoing"]);
});

test("does not confuse warehouse creation with a stock transfer", () => {
  assert.deepEqual(classifyBusinessIntents("create a new warehouse"), ["create_warehouse"]);
  assert.deepEqual(classifyBusinessIntents("transfer stock to warehouse"), ["stock_transfer"]);
});

test("intent hints are explicitly non-authorizing", () => {
  const hints = buildBusinessIntentHints("add 50 kilo chini at 50k");
  assert.equal(hints.policy.includes("do not authorize"), true);
  assert.deepEqual(hints.quantity, { quantity: 50, unit: "kg" });
  assert.equal(hints.amount, 50000);
});

test("detects multiple requested operations without collapsing them into one", () => {
  assert.deepEqual(
    classifyBusinessIntents("add client Rahul and create invoice for Rahul"),
    ["create_invoice", "create_client"],
  );
});

test("does not infer a stock receipt from unrelated use of the word received", () => {
  assert.deepEqual(classifyBusinessIntents("I received your email"), []);
});

test("extracts a quantity from a descriptive request without inventing an operation", () => {
  const hints = buildBusinessIntentHints("chini 50 kilo");
  assert.deepEqual(hints.intents, []);
  assert.deepEqual(hints.quantity, { quantity: 50, unit: "kg" });
});

test("supports Hindi and Hinglish stock and expense phrases", () => {
  assert.deepEqual(classifyBusinessIntents("kharcha darj kar do"), ["create_expense"]);
  assert.deepEqual(classifyBusinessIntents("maal aa gaya"), ["receive_stock"]);
});

test("rejects unsafe or non-finite amount values", () => {
  assert.equal(parseBusinessAmount("-500"), null);
  assert.equal(parseBusinessAmount("₹999999999999999999999"), null);
});

test("asks before choosing an inventory operation from quantity-only language", () => {
  const hints = buildBusinessIntentHints("chini 50 kilo rate 50");
  assert.deepEqual(hints.intents, []);
  assert.equal(hints.ambiguities[0].field, "inventory_operation");
  assert.match(hints.ambiguities[0].question, /new product.*purchase order.*stock received/i);
});

test("flags purchase and receipt as separate lifecycle events when both are requested", () => {
  const hints = buildBusinessIntentHints("create purchase order and receive stock");
  assert.ok(hints.ambiguities.some((item) => item.field === "purchase_lifecycle"));
});
