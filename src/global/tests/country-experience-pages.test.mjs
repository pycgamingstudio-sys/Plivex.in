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
