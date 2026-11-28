import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("bank statement import reuses its idempotency key across retryable follow-up failures", async () => {
  const source = await readFile(new URL("../../components/workspace/WorkspaceBankAccounting.jsx", import.meta.url), "utf8");
  assert.match(source, /const \[importRequestKey,setImportRequestKey\]=useState\(null\)/);
  assert.match(source, /setImportRequestKey\(selected\?crypto\.randomUUID\(\):null\)/);
  assert.match(source, /p_idempotency_key:importRequestKey/);
  assert.doesNotMatch(source, /p_idempotency_key:crypto\.randomUUID\(\)\}\);await rpc\("main_workspace_suggest_bank_matches"/);
  assert.match(source, /setImportRequestKey\(null\);\},"Statement imported/);
});

test("bank statement import validates its date range and balances before sending RPCs", async () => {
  const source = await readFile(new URL("../../components/workspace/WorkspaceBankAccounting.jsx", import.meta.url), "utf8");
  assert.match(source, /statement\.start&&statement\.end&&statement\.start>statement\.end/);
  assert.match(source, /Number\.isFinite\(opening\)\|\|!Number\.isFinite\(closing\)/);
});
