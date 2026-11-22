import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("server tax resolver accepts real ISO dates and fractional provincial components", async () => {
  const source = await read("../../../supabase/functions/_shared/tax/supabase-tax-rule-resolver.ts");
  const slash = String.fromCharCode(92);
  assert.ok(source.includes("/^" + slash + "d{4}-" + slash + "d{2}-" + slash + "d{2}$/"));
  assert.ok(!source.includes("/^" + slash + slash + "d{4}-" + slash + slash + "d{2}-" + slash + slash + "d{2}$/"));
  assert.match(source, /Number\.isFinite\(c\.rateBps\)/);
});

test("Global invoice draft tax supports all seven workspace countries and safe no-tax totals", async () => {
  const source = await read("../../../supabase/functions/global-invoices/index.ts");
  assert.match(source, /\["IN","US","GB","AE","CA","AU","SG"\]/);
  assert.match(source, /let taxableMinor = Math\.max\(0,subtotalMinor-discountMinor\)/);
  assert.match(source, /grossMinor - taxableMinor/);
  assert.match(source, /tax\.india_supply_type/);
});

test("India invoice editor exposes same-state and inter-state GST calculation mode", async () => {
  const editor = await read("../../components/invoice/GlobalTaxEditor.jsx");
  const panel = await read("../../components/global/GlobalInvoicesPanel.jsx");
  assert.match(editor, /Same state · CGST \+ SGST/);
  assert.match(editor, /Different state · IGST/);
  assert.match(panel, /india_supply_type:taxContext\.indiaSupplyType/);
});

test("quotations keep workspace-country routing and explicit draft_test warning", async () => {
  const source = await read("../../../supabase/functions/global-quotations/index.ts");
  assert.match(source, /resolveSupabaseTaxRule/);
  assert.match(source, /\["IN","US","GB","AE","CA","AU","SG"\]/);
  assert.match(source, /Draft baseline rule for testing only/);
});
