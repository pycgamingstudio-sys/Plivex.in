import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("production build edition cannot be downgraded by a local .env value", async () => {
  const vite = await read("../../../vite.config.js");
  const backend = await read("../../api/backendClient.js");
  const html = await read("../../../index.html");
  const verifier = await read("../../../scripts/verify-build-env.mjs");
  assert.match(vite, /process\.env\.VITE_APP_EDITION \|\| env\.VITE_APP_EDITION/);
  assert.match(backend, /import\.meta\.env\.VITE_APP_EDITION === UNIFIED_EDITION_ID/);
  assert.match(html, /name="plivex-build-edition" content="%VITE_APP_EDITION%"/);
  assert.match(verifier, /content="unified"/);
});

test("the actual View Plans modal uses the authenticated workspace country and never defaults to INR", async () => {
  const home = await read("../../pages/Home.jsx");
  const modal = home.slice(home.indexOf("function PricingModal("), home.indexOf("\nfunction Toast("));
  assert.match(home, /countryCode=\{workspaceTaxProfile\?\.countryCode \|\| ""\}/);
  assert.match(home, /currencyCode=\{workspaceTaxProfile\?\.currencyCode \|\| ""\}/);
  assert.match(modal, /countryCode = "", currencyCode = ""/);
  assert.match(modal, /normalizedCountryCode === "IN"/);
  assert.match(modal, /No substitute pricing is shown/);
  assert.match(modal, /normalizedCurrencyCode === "INR"/);
  assert.match(modal, /normalizedCurrencyCode === billingConfig\.currency/);
  assert.doesNotMatch(modal, /countryCode = "IN", currencyCode = "INR"/);
});

test("manually selected workspace country is authoritative over stale business-profile metadata", async () => {
  const home = await read("../../pages/Home.jsx");
  assert.match(home, /supabase\.from\("workspace_settings"\)/);
  assert.match(home, /select\("country_code,currency_code,locale_code"\)/);
  assert.match(home, /const countryCode = String\(settings\?\.country_code/);
  assert.match(home, /const currencyCode = String\(settings\?\.currency_code/);
  assert.match(home, /resolveInvoiceCurrencyForWorkspace\(countryCode, currencyCode\)/);
  assert.doesNotMatch(home, /const countryCode = profileCountry \|\| recordCountry/);
});

test("invoice PDF export waits for the preview and downloads a non-empty PDF blob", async () => {
  const home = await read("../../pages/Home.jsx");
  assert.match(home, /async function waitForInvoicePreview\(timeoutMs = 5000\)/);
  assert.match(home, /const source = await waitForInvoicePreview\(\)/);
  assert.match(home, /const blob = pdf\.output\("blob"\)/);
  assert.match(home, /link\.download = filename/);
  assert.match(home, /URL\.createObjectURL\(blob\)/);
  assert.doesNotMatch(home, /pdf\.save\(/);
  assert.doesNotMatch(home, /Preview is still loading\. Try again in a moment\./);
});

test("a verified non-India membership can switch runtime edition without trusting the legacy workspace ID", async () => {
  const auth = await read("../../lib/AuthContext.jsx");
  const backend = await read("../../api/backendClient.js");
  assert.match(auth, /existingCountry === "IN"/);
  assert.match(auth, /currentUser\?\.country_code && String\(currentUser\.country_code\)\.trim\(\)\.toUpperCase\(\) !== "IN"/);
  assert.match(auth, /verifiedGlobal: edition === "global" && Boolean\(globalUser\)/);
  assert.match(backend, /!isUnifiedBuild && edition === "global" && !verifiedGlobal/);
});
