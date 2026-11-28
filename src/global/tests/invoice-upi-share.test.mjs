import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read=(path)=>readFileSync(new URL(path,import.meta.url),"utf8");
const sanitizer=read("../../../supabase/functions/_shared/public-invoice-sanitizer.mjs");
const page=read("../../pages/PublicInvoicePage.jsx");
const stores=read("../../lib/stores.js");

test("shared Main Workspace invoices retain the seller-provided UPI destination without exposing other profile fields",()=>{
  assert.match(sanitizer,/snapshot\.shareUpiPayment === true && typeof snapshot\.upiId === "string"/);
  assert.match(stores,/upiId: str\(r\?\.upi_id\)/);
  assert.match(stores,/upi_id: str\(p\?\.upiId\)/);
  const home=read("../../pages/Home.jsx");
  assert.match(home,/shareUpiPayment: false/);
  assert.match(home,/Show UPI pay link and QR on the customer invoice-share page/);
});

test("public shared INR invoices offer UPI deep link and QR only for valid unpaid invoices",()=>{
  assert.match(page,/countryCode==="IN"/);
  assert.match(page,/currency\|\|""\)\.toUpperCase\(\)==="INR"/);
  assert.match(page,/upi:\/\/pay\?pa=/);
  assert.match(page,/invoice-upi-payment/);
  assert.match(page,/Pay via UPI/);
  assert.match(page,/String\(invoice\?\.status\|\|""\)\.toLowerCase\(\)!=="paid"/);
  assert.match(page,/The business must verify receipt before marking the invoice as paid/);
});
