import test from "node:test";
import assert from "node:assert/strict";
import { isAffirmativeConfirmation } from "../../lib/assistant-confirmation-intent.mjs";

test("recognizes clear English and Hinglish confirmations", () => {
  for (const value of ["Yes", "yes please", "Yeah!", "haan", "Han", "ji haan", "bilkul", "confirm and save", "kar do", "ठीक है", "हाँ"]) {
    assert.equal(isAffirmativeConfirmation(value), true, value);
  }
});
test("does not treat questions, corrections, or negative replies as confirmation", () => {
  for (const value of ["No", "not yet", "yes but change amount", "yes, add another item", "why?", "please explain", ""]) {
    assert.equal(isAffirmativeConfirmation(value), false, value);
  }
});
