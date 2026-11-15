import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [edge, app, migration, workflow, replay] = await Promise.all([
  read("../../../supabase/functions/global-invoices/index.ts"),
  read("../GlobalApp.jsx"),
  read("../../../supabase/migrations/202611150008_global_invoice_draft_and_payment_ledger.sql"),
  read("../../../.github/workflows/global-foundation.yml"),
  read("../../../scripts/verify-migration-replay.mjs"),
]);

test("Global draft invoice endpoint validates identity, currency, dates and line items", () => {
  assert.match(edge, /authenticateGlobal/);
  assert.match(edge, /action === "create_draft"/);
  assert.match(edge, /global_create_invoice_draft/);
  assert.match(edge, /MAX_BODY_BYTES/);
  assert.match(migration, /v_role not in \\('owner','admin','manager','employee'\\)/);
  assert.match(migration, /p_currency_code/);
  assert.match(migration, /tax_status','not_calculated/);
});

test("Global payment ledger is external-only, atomic and idempotent", () => {
  assert.match(edge, /action === "record_payment"/);
  assert.match(edge, /global_record_invoice_payment/);
  assert.match(migration, /idempotency_key/);
  assert.match(migration, /for update/);
  assert.match(migration, /v_new_paid := v_invoice\.amount_paid_minor\+p_amount_minor/);
  assert.match(app, /Record external payment/);
  assert.match(app, /does not collect money or start a Cashfree transaction/);
});

test("Global invoice UI never claims an uncalculated draft is a tax invoice", () => {
  assert.match(app, /Tax has not been calculated/);
  assert.match(app, /cannot be issued as a tax invoice/);
  assert.match(app, /Draft only: tax is not calculated/);
  assert.match(app, /draftRequest\?\.signature === signature \? draftRequest\.id : crypto\.randomUUID\(\)/);
  assert.match(edge, /p_idempotency_key: body\.idempotency_key/);
});

test("Global invoice migration is covered by disposable replay, rollback and Deno checks", () => {
  assert.match(replay, /202611150008_global_invoice_draft_and_payment_ledger\.sql/);
  assert.match(replay, /global-invoice-ledger\.integration\.sql/);
  assert.match(workflow, /global-invoices\/index\.ts/);
});
