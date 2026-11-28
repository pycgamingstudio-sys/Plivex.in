import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const app = read("../../App.jsx");
const dashboard = read("../../pages/Dashboard.jsx");
const homeGate = read("../../components/HomeGate.jsx");
const appLayout = read("../../components/AppLayout.jsx");
const nav = read("../../lib/nav.js");
const tools = read("../../pages/WorkspacePlatformPage.jsx");

test("primary workspace modules have stable direct URLs", () => {
  for (const route of ["dashboard", "sales", "purchase", "books", "ai", "reports", "crm", "stock", "warehouses", "reconciliation", "more"]) {
    assert.match(app, new RegExp('path="/workspace/' + route + '"'));
  }
  assert.match(dashboard, /if \(initialTab\) setTab\(initialTab\)/);
  assert.doesNotMatch(homeGate, /key=\{location\.pathname\}/);
});

test("Business Tools is a primary destination with category and individual tool routes", () => {
  assert.match(nav, /to: "\/platform", label: "Business tools center"/);
  assert.match(app, /path="\/platform\/:group"/);
  assert.match(app, /path="\/platform\/:group\/:tool"/);
  for (const slug of ["signature-audit", "document-ocr", "whatsapp-cloud", "public-api", "gst-compliance", "bank-accounting", "analytics", "serial-traceability", "supplier-portal", "sales-documents", "recurring-invoices", "enterprise-controls"]) {
    assert.ok(tools.includes('"' + slug + '"'), "missing dedicated tool route: " + slug);
  }
});

test("workspace shell has responsive desktop sidebar and a dedicated mobile primary bar", () => {
  assert.match(dashboard, /fixed inset-y-0 left-0[\s\S]*md:flex/);
  assert.match(appLayout, /aria-label="Primary workspace navigation"/);
  assert.match(appLayout, /aria-label="Main workspace navigation"/);
  for (const label of ["Home", "Sales", "Books", "AI", "More"]) assert.match(homeGate, new RegExp('label: "' + label + '"'));
});

test("individual tool pages mount only their selected feature and load only its own data", () => {
  assert.match(tools, /toolParam === "signature-audit"/);
  assert.match(tools, /toolParam === "public-api"/);
  assert.match(tools, /toolParam === "whatsapp-cloud"/);
  assert.match(tools, /toolParam==="gst-compliance"/);
  assert.match(tools, /toolParam==="enterprise-controls"/);
  assert.doesNotMatch(tools, /toolFilterCss|data-tool=/);
});

test("Plivex Nova branding is applied without removing OCR review safeguards", () => {
  assert.match(tools, /Document OCR & AI extraction · Plivex Nova/);
  assert.match(tools, /no accounting records are posted automatically/);
});
