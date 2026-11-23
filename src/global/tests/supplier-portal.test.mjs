import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../../../supabase/migrations/20261123012000_global_supplier_onboarding_portal.sql", import.meta.url), "utf8");
const endpoint = await readFile(new URL("../../../supabase/functions/global-supplier-portal/index.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../../pages/SupplierPortalPage.jsx", import.meta.url), "utf8");
const app = await readFile(new URL("../../App.jsx", import.meta.url), "utf8");
const panel = await readFile(new URL("../../components/global/GlobalPart4Panel.jsx", import.meta.url), "utf8");
const globalApp = await readFile(new URL("../GlobalApp.jsx", import.meta.url), "utf8");
const config = await readFile(new URL("../../../supabase/config.toml", import.meta.url), "utf8");

test("supplier onboarding portal stores only token hashes and enforces single-use expiry", () => {
  assert.match(migration, /create table if not exists global\.supplier_portal_invites/);
  assert.match(migration, /token_hash text not null unique/);
  assert.match(migration, /expires_at>now\(\)/);
  assert.match(migration, /status='used',used_at=now\(\)/);
  assert.match(migration, /status='revoked'/);
  assert.match(migration, /country_code.*IN.*US.*GB.*AE.*CA.*AU.*SG/);
  assert.doesNotMatch(migration, /token text/i);
  assert.match(migration, /revoke all on function public\.global_supplier_portal_read\(text\) from public,anon,authenticated/);
  assert.match(migration, /grant execute on function public\.global_supplier_portal_submit\(text,jsonb\) to service_role/);
});

test("supplier portal Edge Function authenticates internal actions and hashes public tokens", () => {
  assert.match(endpoint, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(endpoint, /authenticateGlobal\(req\)/);
  assert.match(endpoint, /global_supplier_portal_invite/);
  assert.match(endpoint, /global_supplier_portal_list/);
  assert.match(endpoint, /global_supplier_portal_decide/);
  assert.match(endpoint, /global_supplier_portal_read/);
  assert.match(endpoint, /global_supplier_portal_submit/);
  assert.match(endpoint, /sendEmail\(/);
  assert.match(endpoint, /MAX_BODY/);
});

test("supplier portal is reachable publicly and managed inside the authenticated Global workspace", () => {
  assert.match(app, /path="\/supplier-portal"/);
  assert.match(app, /path="\/suppliers"/);
  assert.match(page, /portal\.read/);
  assert.match(page, /portal\.submit/);
  assert.match(panel, /Vendor onboarding & supplier portal/);
  assert.match(panel, /Create secure invitation/);
  assert.match(panel, /reviewSupplier/);
  assert.match(globalApp, /suppliers: "\/suppliers"/);
  assert.match(config, /\[functions\.global-supplier-portal\]\s+verify_jwt = false/);
});
