import test from "node:test";
import assert from "node:assert/strict";
import {
  canIssueCommercialInvoice,
  getGlobalInvoiceDocumentTitle,
  getGlobalInvoiceTaxDisclosure,
  resolveGlobalInvoiceContext,
} from "../invoices/invoice-readiness.js";

test("Global invoice context accepts only the exact workspace country/base-currency pair", () => {
  for (const [country_code,currency_code] of [["US","USD"],["GB","GBP"],["AE","AED"],["CA","CAD"],["AU","AUD"],["SG","SGD"]]) {
    assert.deepEqual(resolveGlobalInvoiceContext({ country_code,currency_code }), { ok:true,countryCode:country_code,currencyCode:currency_code });
  }
  assert.equal(resolveGlobalInvoiceContext({ country_code:"US",currency_code:"INR" }).reason,"workspace_currency_mismatch");
  assert.equal(resolveGlobalInvoiceContext({ country_code:"IN",currency_code:"INR" }).reason,"unsupported_country");
  assert.equal(resolveGlobalInvoiceContext({ country_code:"",currency_code:"" }).ok,false);
});

test("Commercial issuance requires a ready workspace, server capability, draft and seller identity", () => {
  const ready = { workspaceReady:true,issuanceReady:true,status:"draft",sellerProfileReady:true };
  assert.equal(canIssueCommercialInvoice(ready),true);
  for (const key of Object.keys(ready)) {
    assert.equal(canIssueCommercialInvoice({ ...ready,[key]:key==="status"?"issued":false }),false);
  }
});

test("Document title never mislabels a commercial invoice as a tax invoice", () => {
  assert.equal(getGlobalInvoiceDocumentTitle({ document_type:"commercial_invoice",tax_status:"not_assessed" },"issued"),"COMMERCIAL INVOICE");
  assert.equal(getGlobalInvoiceDocumentTitle({ tax_status:"calculated" },"issued"),"TAX INVOICE");
  assert.equal(getGlobalInvoiceDocumentTitle({ document_type:"commercial_invoice" },"draft"),"DRAFT INVOICE");
  assert.match(getGlobalInvoiceTaxDisclosure({ tax_status:"not_assessed" }),/not been calculated or validated/i);
});

import { resolveWorkspaceBillingContext } from "../billing/pricing.js";

test("workspace pricing requires the exact country and currency, with no INR fallback", () => {
  assert.equal(resolveWorkspaceBillingContext("US","USD").ok,true);
  assert.equal(resolveWorkspaceBillingContext("US","INR").reason,"workspace_currency_mismatch");
  assert.equal(resolveWorkspaceBillingContext("XX","INR").reason,"country_not_configured");
  assert.equal(resolveWorkspaceBillingContext("GB","").currencyCode,"GBP");
});
