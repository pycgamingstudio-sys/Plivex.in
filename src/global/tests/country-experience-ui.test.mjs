import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Global tax summary does not render India GST or GSTR-1 workflows", async () => {
  const source = await read("../../pages/TaxSummary.jsx");
  const globalBranch = source.slice(source.indexOf('if (APP_EDITION === "global")'), source.indexOf("  return (", source.indexOf('if (APP_EDITION === "global")')));
  assert.match(source, /APP_EDITION/);
  assert.match(globalBranch, /getCountryExperience/);
  assert.match(globalBranch, /getGlobalTaxCapability/);
  assert.doesNotMatch(globalBranch, /GSTR-1|GSTIN|CGST|SGST|IGST|₹/);
  assert.match(source, /Export GSTR-1 Return/);
});

test("Global invoice editor hides India-only UPI and HSN/SAC controls", async () => {
  const source = await read("../../pages/Home.jsx");
  assert.match(source, /!isGlobalWorkspace && <div className="mt-3"><Field label="Your UPI ID \/ VPA"/);
  assert.match(source, /isGlobalWorkspace \? <input value=\{item\.description\}/);
  assert.match(source, /!isGlobalWorkspace && item\.hsnSac/);
  assert.match(source, /countryExperience\?\.business\.registrationLabel/);
});
