import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const backend = readFileSync(new URL("../../api/backendClient.js", import.meta.url), "utf8");
const paywall = readFileSync(new URL("../../lib/paywall.jsx", import.meta.url), "utf8");

test("retired PayU checkout cannot be invoked through the frontend function allowlist", () => {
  assert.doesNotMatch(backend, /"create-payu-order"/);
  assert.doesNotMatch(paywall, /create-payu-order|verify-payu-payment/);
  assert.match(paywall, /startCashfreeCheckout/);
});
