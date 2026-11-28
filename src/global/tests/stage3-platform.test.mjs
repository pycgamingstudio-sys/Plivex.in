import test from "node:test";
import assert from "node:assert/strict";
import {
  COUNTRY_REGISTRY,
  getCountryByCode,
  listSelectableCountries,
} from "../countries/country-registry.js";
import { getCurrencyPrecision } from "../money/currency-precision.js";
import { convertMinorAmount, validateExchangeRateSnapshot } from "../money/exchange-rate.js";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Stage 3 preserves exactly the seven supported country identities and currency mappings", () => {
  assert.deepEqual(COUNTRY_REGISTRY.map((country) => country.code), ["IN", "US", "GB", "AE", "CA", "AU", "SG"]);
  const expected = {
    IN: ["INR", ["en-IN", "hi-IN"]],
    US: ["USD", ["en-US", "es-US"]],
    GB: ["GBP", ["en-GB"]],
    AE: ["AED", ["en-AE", "ar-AE"]],
    CA: ["CAD", ["en-CA", "fr-CA"]],
    AU: ["AUD", ["en-AU"]],
    SG: ["SGD", ["en-SG", "zh-SG", "ms-SG", "ta-SG"]],
  };
  for (const [code, [currency, locales]] of Object.entries(expected)) {
    const country = getCountryByCode(code);
    assert.ok(country, code + " must be selectable");
    assert.equal(country.currencyCode, currency);
    assert.deepEqual(country.locales, locales);
    assert.equal(getCurrencyPrecision(country.currencyCode), 2);
    assert.equal(country.capability, "identity-only");
  }
  assert.equal(getCountryByCode("ZZ"), null);
  assert.equal(getCountryByCode("INR"), null);
  const copy = listSelectableCountries();
  copy[0].locales.push("xx");
  assert.deepEqual(getCountryByCode("IN").locales, ["en-IN", "hi-IN"]);
});

test("FX conversion stays integer/rational and supports every Stage 3 country currency", () => {
  const currencyCodes = COUNTRY_REGISTRY.map((country) => country.currencyCode);
  for (const quoteCurrency of currencyCodes.filter((code) => code !== "USD")) {
    const snapshot = {
      id: "fixture-usd-" + quoteCurrency,
      baseCurrency: "USD",
      quoteCurrency,
      rateNumerator: "127",
      rateDenominator: "100",
      effectiveAt: "2026-11-01T00:00:00Z",
      capturedAt: "2026-11-01T01:00:00Z",
      source: "https://rates.example.test/fixture",
      provider: "Unit test fixture (not a live FX quote)",
    };
    assert.equal(validateExchangeRateSnapshot(snapshot).ok, true);
    const converted = convertMinorAmount(10000, snapshot);
    assert.equal(converted.ok, true);
    assert.equal(converted.quoteAmountMinor, 12700);
    assert.equal(converted.quoteCurrency, quoteCurrency);
    assert.equal(converted.rounding, "half-up");
  }
  const halfCent = {
    id: "fixture-half-up",
    baseCurrency: "USD",
    quoteCurrency: "GBP",
    rateNumerator: "1",
    rateDenominator: "2",
    effectiveAt: "2026-11-01T00:00:00Z",
    capturedAt: "2026-11-01T01:00:00Z",
    source: "https://rates.example.test/fixture",
    provider: "Unit test fixture",
  };
  assert.equal(convertMinorAmount(1, halfCent).quoteAmountMinor, 1);
});

test("public API write scope is consistent across database, Edge Function and docs", () => {
  const scopeMigration = read("../../../supabase/migrations/20261128150000_stage3_public_api_lead_write_scope.sql");
  const idempotencyMigration = read("../../../supabase/migrations/20261128140000_stage3_public_api_v1_idempotency.sql");
  const api = read("../../../supabase/functions/workspace-platform/index.ts");
  const docs = read("../../../docs/public-api-v1.md");
  const webhookMigration = read("../../../supabase/migrations/20261128130000_stage3_integration_automation_vault_foundation.sql");
  const webhookEdge = read("../../../supabase/functions/workspace-stage3/index.ts");
  const stage3Ui = read("../../components/workspace/WorkspaceStage3Center.jsx");
  const platformEdge = read("../../../supabase/functions/workspace-platform/index.ts");
  const supabaseConfig = read("../../../supabase/config.toml");
  assert.ok(scopeMigration.includes("'leads.write'"));
  assert.ok(scopeMigration.includes("cardinality(scopes) between 1 and 9"));
  assert.ok(idempotencyMigration.includes("main_workspace_api_create_lead"));
  assert.ok(idempotencyMigration.includes("pg_advisory_xact_lock"));
  assert.ok(idempotencyMigration.includes("IDEMPOTENCY_KEY_REUSED"));
  assert.ok(api.includes("scopes.length > 9"));
  assert.ok(api.includes('scope("leads.write")'));
  assert.ok(api.includes('req.headers.get("idempotency-key")'));
  assert.ok(docs.includes("up to nine distinct scopes"));
  assert.ok(webhookMigration.includes("secret_name text unique"));
  assert.ok(webhookMigration.includes("provider_key = 'shopify' and secret_name is null"));
  assert.ok(webhookMigration.includes("if p_provider_key = 'custom' then"));
  assert.ok(webhookEdge.includes('Deno.env.get("SHOPIFY_API_SECRET")'));
  assert.ok(webhookEdge.includes("main_workspace_get_webhook_secret"));
  assert.ok(webhookEdge.includes("WEBHOOK_PROVIDER_UNSUPPORTED"));
  assert.ok(stage3Ui.includes("SHOPIFY_API_SECRET"));
  assert.ok(platformEdge.includes("MAX_REQUEST_BYTES = 6 * 1024 * 1024"));
  assert.ok(platformEdge.includes("encoder.encode(rawBody).byteLength > MAX_REQUEST_BYTES"));
  assert.ok(platformEdge.includes("INVALID_JSON"));
  assert.ok(supabaseConfig.includes("[functions.workspace-stage3]\nverify_jwt = false"));
});
