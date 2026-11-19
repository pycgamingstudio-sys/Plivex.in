import test from "node:test";
import assert from "node:assert/strict";
import { classifyBusinessIntents, buildBusinessIntentHints, parseBusinessAmount, parseBusinessQuantity } from "./assistant-intent-planner.mjs";

// Generated acceptance corpus: 1,200 unseen combinations across supported and
// intentionally unsupported business intents. This is an evaluation corpus,
// not a production rule list or permission to execute an action.
const families = [
  { type: "create_invoice", verbs: ["create", "make", "prepare", "generate", "bana"], nouns: ["invoice", "bill", "tax invoice"], expected: "create_invoice" },
  { type: "create_quotation", verbs: ["create", "make", "prepare", "generate", "bana"], nouns: ["quotation", "quote", "estimate"], expected: "create_quotation" },
  { type: "create_client", verbs: ["add", "create", "save", "register", "jodo"], nouns: ["client", "customer", "buyer"], expected: "create_client" },
  { type: "create_expense", verbs: ["add", "record", "save", "log", "darj"], nouns: ["expense", "kharcha", "business cost"], expected: "create_expense" },
  { type: "create_lead", verbs: ["add", "create", "save", "capture", "jodo"], nouns: ["lead", "prospect", "enquiry"], expected: "create_lead" },
  { type: "create_stock", verbs: ["add", "create", "save", "register", "jodo"], nouns: ["stock item", "inventory item", "product"], expected: "create_stock" },
  { type: "create_purchase_order", verbs: ["create", "make", "place", "raise", "prepare"], nouns: ["purchase order", "PO", "supplier order"], expected: "create_purchase_order" },
  { type: "receive_stock", verbs: ["receive", "received", "book in", "accept", "record"], nouns: ["stock", "goods", "inventory"], expected: "receive_stock" },
  { type: "create_warehouse", verbs: ["add", "create", "open", "register", "set up"], nouns: ["warehouse", "godown", "stockroom"], expected: "create_warehouse" },
  { type: "stock_transfer", verbs: ["transfer", "move", "shift", "relocate", "send"], nouns: ["stock", "inventory", "items"], expected: "stock_transfer" },
  { type: "supplier", verbs: ["add", "create", "save", "register", "new"], nouns: ["supplier", "vendor"], expected: "supplier" },
  { type: "staff", verbs: ["add", "create", "register", "hire", "onboard"], nouns: ["staff", "employee", "worker"], expected: "staff" },
  { type: "branch", verbs: ["add", "create", "open", "register"], nouns: ["branch", "outlet"], expected: "branch" },
  { type: "automation", verbs: ["automate", "schedule", "set up", "create"], nouns: ["reminder", "workflow", "automation"], expected: "automation" },
];

const wrappers = [
  (v, n, i) => `${v} ${n} for my business ${i}`,
  (v, n, i) => `please ${v} a ${n} ${i}`,
  (v, n, i) => `bhai ${n} ${v} kar do ${i}`,
  (v, n, i) => `${v} ${n} in Plivex ${i}`,
  (v, n, i) => `I need to ${v} ${n} ${i}`,
  (v, n, i) => `${n} ${v} now ${i}`,
];

const corpus = [];
for (let index = 0; index < 1200; index += 1) {
  const family = families[index % families.length];
  const verb = family.verbs[Math.floor(index / families.length) % family.verbs.length];
  const noun = family.nouns[Math.floor(index / (families.length * 2)) % family.nouns.length];
  const wrapper = wrappers[Math.floor(index / (families.length * 3)) % wrappers.length];
  corpus.push({ text: wrapper(verb, noun, index), expected: family.expected });
}

test("classifies 1,200 generated business request variations without confusing modules", () => {
  assert.equal(corpus.length, 1200);
  const failures = corpus.flatMap((item) => {
    const actual = classifyBusinessIntents(item.text);
    return actual.includes(item.expected) ? [] : [{ ...item, actual }];
  });
  assert.deepEqual(failures.slice(0, 20), []);
});

test("keeps read intent separate from unsupported write capability", () => {
  assert.deepEqual(classifyBusinessIntents("show my overdue invoices"), []);
  assert.ok(classifyBusinessIntents("add supplier for this purchase").includes("supplier"));
  assert.ok(classifyBusinessIntents("hire a new employee").includes("staff"));
  assert.ok(classifyBusinessIntents("schedule an automatic payment reminder").includes("automation"));
});

test("handles multilingual numeric and inventory quantities safely", () => {
  assert.equal(parseBusinessAmount("₹1,25,000"), 125000);
  assert.equal(parseBusinessAmount("1.5 lakh"), 150000);
  assert.equal(parseBusinessAmount("2 crore"), 20000000);
  assert.equal(parseBusinessAmount("not sure"), null);
  assert.deepEqual(parseBusinessQuantity("12 kilograms"), { quantity: 12, unit: "kg" });
  assert.deepEqual(parseBusinessQuantity("5 litre"), { quantity: 5, unit: "litre" });
});

test("flags lifecycle ambiguity instead of merging order and receipt events", () => {
  const result = buildBusinessIntentHints("create purchase order and receive goods");
  assert.ok(result.ambiguities.some((item) => item.field === "purchase_lifecycle"));
});
