import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Global dashboard does not gate regional tax summary behind India GSTR entitlement", async () => {
  const source = await read("../../pages/Dashboard.jsx");
  assert.match(source, /APP_EDITION === "global" \|\|/);
  assert.match(source, /Tax reporting is available on eligible plans/);
});

test("Global client database uses country-specific tax registration and phone labels", async () => {
  const source = await read("../../pages/ClientDatabase.jsx");
  assert.match(source, /getCountryExperience\(user\?\.country_code\)/);
  assert.match(source, /countryExperience\?\.business\.registrationLabel/);
  assert.match(source, /phonePrefix/);
  assert.doesNotMatch(source, /GSTIN \{c\.gstin\}/);
});

test("Global help center does not show India GST or India-only phone support", async () => {
  const source = await read("../../pages/HelpCenter.jsx");
  assert.match(source, /APP_EDITION === "global" \?/);
  assert.match(source, /Review tax before issuing/);
  assert.match(source, /APP_EDITION !== "global" && <a href="tel:9758455218"/);
});


test("public Global invoice uses the selected country's registration label", async () => {
  const source = await read("../../pages/PublicInvoicePage.jsx");
  assert.match(source, /getCountryExperience\(countryCode\)/);
  assert.match(source, /registrationLabel\}: \{business\.gstin\}/);
  assert.doesNotMatch(source, /GSTIN: \{business\.gstin\}/);
});

test("Global invoice PDF uses country tax and registration terminology", async () => {
  const source = await read("../../components/global/GlobalInvoicesPanel.jsx");
  assert.match(source, /experience\?\.business\.taxName/);
  assert.match(source, /experience\?\.business\.registrationLabel/);
  assert.match(source, /account\?\.locale_code/);
  assert.doesNotMatch(source, /new Intl\.NumberFormat\(undefined/);
});

test("regional account activity and reports use workspace locale metadata", async () => {
  const activity = await read("../../pages/AccountActivity.jsx");
  const reports = await read("../../pages/UsageReports.jsx");
  assert.match(activity, /user\?\.locale_code/);
  assert.match(activity, /formatWorkspaceDateTime/);
  assert.match(reports, /formatCurrency/);
  assert.match(reports, /formatWorkspaceDate/);
});


test("India-only tools are not rendered for Global workspaces, including missing country context", async () => {
  const source = await read("../../App.jsx");
  assert.match(source, /APP_EDITION === "global" && user\?\.country_code !== "IN"/);
  for (const feature of ["Shared invoice links", "Usage reports", "Quick templates", "Payment logs", "Service catalog", "Team management"]) {
    assert.ok(source.includes(`feature="${feature}"`), `missing Global gate for ${feature}`);
  }
  assert.match(source, /Open Global invoices/);
});


test("public marketing copy distinguishes Global availability from India-only features", async () => {
  const pages = await read("../../pages/PublicInfoPages.jsx");
  const about = await read("../../components/landing/AboutSection.jsx");
  assert.doesNotMatch(pages, /platform for Indian small businesses/);
  assert.match(pages, /tax fields and invoice issuance depend on the selected country/);
  assert.match(about, /India edition: CGST\/SGST\/IGST auto-breakup/);
  assert.match(about, /Global UI: English/);
  assert.match(about, /Global capabilities are being introduced in stages/);
});


test("public legal copy describes country-dependent tax workflows rather than GST-only service", async () => {
  const privacy = await read("../../pages/PrivacyPolicy.jsx");
  const terms = await read("../../pages/TermsOfService.jsx");
  assert.match(privacy, /country-specific tax registration details/);
  assert.match(privacy, /Feature availability depends on your workspace country/);
  assert.match(terms, /selected workspace country/);
  assert.match(terms, /not legal, accounting, or tax advice/);
  assert.doesNotMatch(privacy, /automated GST calculation/);
  assert.doesNotMatch(terms, /accurate GSTIN/);
});
