import test from "node:test";
import assert from "node:assert/strict";
import { detectSupplementaryContextNeeds } from "./assistant-context-intent.mjs";

test("English workspace overview loads all supplementary context", () => {
  const result = detectSupplementaryContextNeeds("show me all my workspace records");
  assert.equal(result.overviewRequest, true);
  for (const key of ["wantsInvoiceItems","wantsLeadActivities","wantsReceiptItems","wantsReminders","wantsStockAllocations","wantsAccounting","wantsWorkspaceSettings","wantsMembers"]) {
    assert.equal(result[key], true, key);
  }
});

test("module-specific English terms trigger only the relevant context", () => {
  assert.equal(detectSupplementaryContextNeeds("show invoice line items").wantsInvoiceItems, true);
  assert.equal(detectSupplementaryContextNeeds("show lead follow-up history").wantsLeadActivities, true);
  assert.equal(detectSupplementaryContextNeeds("show overdue reminders").wantsReminders, true);
  assert.equal(detectSupplementaryContextNeeds("show ledger accounts").wantsAccounting, true);
});

test("Hindi module terms are recognized", () => {
  assert.equal(detectSupplementaryContextNeeds("मेरे सभी रिकॉर्ड दिखाओ").overviewRequest, true);
  assert.equal(detectSupplementaryContextNeeds("रिमाइंडर दिखाओ").wantsReminders, true);
  assert.equal(detectSupplementaryContextNeeds("टीम के सदस्य दिखाओ").wantsMembers, true);
});

test("casual chat does not request supplementary business tables", () => {
  const result = detectSupplementaryContextNeeds("hello, how are you?");
  assert.equal(Object.values(result).some(Boolean), false);
});
