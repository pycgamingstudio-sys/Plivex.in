import test from "node:test";
import assert from "node:assert/strict";
import { parseIndianGstin, getIndianGstinState, findSavedGstinRecords } from "../tax/gstin.js";

test("parses GSTIN format and detects state and PAN entity type without claiming verification", () => {
  const result = parseIndianGstin("09AAACB1234C1Z5");
  assert.equal(result.ok, true);
  assert.equal(result.stateCode, "09");
  assert.equal(result.stateName, "Uttar Pradesh");
  assert.equal(result.pan, "AAACB1234C");
  assert.equal(result.panEntityType, "Company");
  assert.equal(result.verification, "format_only");
  assert.match(result.warning, /not verified against government records/i);
});

test("identifies individual PAN category and normalizes whitespace/case", () => {
  const result = parseIndianGstin("09 aaapa1234a1z5");
  assert.equal(result.ok, true);
  assert.equal(result.gstin, "09AAAPA1234A1Z5");
  assert.equal(result.panEntityType, "Individual");
});

test("rejects malformed GSTIN and unknown state codes", () => {
  assert.equal(parseIndianGstin("123").code, "INVALID_GSTIN_FORMAT");
  assert.equal(parseIndianGstin("99AAACB1234C1Z5").code, "UNKNOWN_GSTIN_STATE_CODE");
  assert.equal(getIndianGstinState("invalid"), null);
});

test("matches only exact GSTIN records already supplied from the current workspace", () => {
  const records = [
    { id:"client-1", name:"Saved customer", tax_registration_number:"09AAACB1234C1Z5" },
    { id:"client-2", name:"Other customer", tax_registration_number:"27AAACB1234C1Z5" },
    { id:"supplier-1", name:"Saved supplier", gstin:"09AAACB1234C1Z5" },
  ];
  assert.deepEqual(
    findSavedGstinRecords(records, "09 aaacb1234c1z5").map((row) => row.id),
    ["client-1", "supplier-1"],
  );
  assert.deepEqual(findSavedGstinRecords(records, "bad"), []);
  assert.deepEqual(findSavedGstinRecords(null, "09AAACB1234C1Z5"), []);
});
