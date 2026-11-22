import test from "node:test";
import assert from "node:assert/strict";
import { parseIndianGstin, getIndianGstinState } from "../tax/gstin.js";

test("parses a structurally valid GSTIN and detects its state code", () => {
  const parsed = parseIndianGstin("09ABCDE1234F1Z5");
  assert.equal(parsed.ok, true);
  assert.equal(parsed.stateCode, "09");
  assert.equal(parsed.stateName, "Uttar Pradesh");
  assert.equal(parsed.pan, "ABCDE1234F");
  assert.equal(parsed.verification, "format_only");
  assert.equal(getIndianGstinState("09ABCDE1234F1Z5").stateCode, "09");
});

test("rejects malformed GSTINs and unknown state codes", () => {
  assert.equal(parseIndianGstin("ABCDE1234F1Z5").ok, false);
  assert.equal(parseIndianGstin("00ABCDE1234F1Z5").code, "UNKNOWN_GSTIN_STATE_CODE");
  assert.equal(parseIndianGstin("09ABCDE1234F1X5").code, "INVALID_GSTIN_FORMAT");
});

test("does not claim to verify a GSTIN against government records", () => {
  assert.match(parseIndianGstin("09ABCDE1234F1Z5").warning, /not verified against government records/i);
});
