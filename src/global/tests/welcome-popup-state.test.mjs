import test from "node:test";
import assert from "node:assert/strict";
import { canScheduleWelcomePopup, isWelcomePopupVisible, markWelcomePopupDismissed, welcomePopupSeenKey } from "../../components/welcome-popup-state.js";

function memoryStorage() {
  const values = new Map();
  return { getItem(key) { return values.has(key) ? values.get(key) : null; }, setItem(key, value) { values.set(key, String(value)); }, snapshot() { return Object.fromEntries(values); } };
}

test("account A to B switching never displays A popup for B", () => {
  const storage = memoryStorage();
  assert.equal(canScheduleWelcomePopup({ userId: "A", planLoading: false, storage }), true);
  assert.equal(isWelcomePopupVisible({ activeUserId: "B", openForUser: "A", planLoading: false }), false);
  assert.equal(isWelcomePopupVisible({ activeUserId: "A", openForUser: "A", planLoading: false }), true);
});
test("logout hides popup and subsequent login is evaluated for new account", () => {
  const storage = memoryStorage();
  assert.equal(isWelcomePopupVisible({ activeUserId: null, openForUser: "A", planLoading: false }), false);
  assert.equal(canScheduleWelcomePopup({ userId: "B", planLoading: false, storage }), true);
  assert.equal(isWelcomePopupVisible({ activeUserId: "B", openForUser: "A", planLoading: false }), false);
});
test("subscription loading guard prevents scheduling and rendering", () => {
  const storage = memoryStorage();
  assert.equal(canScheduleWelcomePopup({ userId: "A", planLoading: true, storage }), false);
  assert.equal(isWelcomePopupVisible({ activeUserId: "A", openForUser: "A", planLoading: true }), false);
  assert.equal(canScheduleWelcomePopup({ userId: "A", planLoading: false, storage }), true);
});
test("dismissal is stored independently per account", () => {
  const storage = memoryStorage();
  assert.equal(welcomePopupSeenKey("A"), "plivex:welcomeSeen:A");
  assert.equal(markWelcomePopupDismissed({ userId: "A", storage }), true);
  assert.equal(canScheduleWelcomePopup({ userId: "A", planLoading: false, storage }), false);
  assert.equal(canScheduleWelcomePopup({ userId: "B", planLoading: false, storage }), true);
  assert.deepEqual(storage.snapshot(), { "plivex:welcomeSeen:A": "1" });
});
test("popup never appears for wrong or logged-out account", () => {
  for (const activeUserId of ["B", null, undefined]) assert.equal(isWelcomePopupVisible({ activeUserId, openForUser: "A", planLoading: false }), false);
  assert.equal(isWelcomePopupVisible({ activeUserId: "A", openForUser: "A", planLoading: false }), true);
});
test("storage failures fail closed", () => {
  const storage = { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); } };
  assert.equal(canScheduleWelcomePopup({ userId: "A", planLoading: false, storage }), false);
  assert.equal(markWelcomePopupDismissed({ userId: "A", storage }), false);
});