/**
 * Deterministic, advisory business-intent hints for Plivex AI.
 * These hints never authorize writes; server validators and the confirmation RPC remain authoritative.
 */
const AMOUNT_RE = /^\\s*(?:₹|rs\\.?\\s*|inr\\s*)?([0-9][0-9,]*(?:\\.[0-9]+)?)\\s*(k|thousand|lakh|lac|cr|crore)?\\s*$/i;
const MULTIPLIERS = Object.freeze({ k: 1000, thousand: 1000, lakh: 100000, lac: 100000, cr: 10000000, crore: 10000000 });

export function parseBusinessAmount(value) {
  const match = String(value ?? "").trim().match(AMOUNT_RE);
  if (!match) return null;
  const base = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(base) || base < 0) return null;
  const multiplier = MULTIPLIERS[String(match[2] || "").toLowerCase()] || 1;
  const amount = base * multiplier;
  return Number.isSafeInteger(Math.round(amount * 100)) ? amount : null;
}

const UNIT_ALIASES = Object.freeze({
  kg: "kg", kgs: "kg", kilo: "kg", kilos: "kg", kilogram: "kg", kilograms: "kg",
  g: "g", gm: "g", gram: "g", grams: "g",
  l: "litre", lt: "litre", ltr: "litre", litre: "litre", liter: "litre", liters: "litre", litres: "litre",
  pc: "pcs", pcs: "pcs", piece: "pcs", pieces: "pcs", packet: "packet", packets: "packet",
  box: "box", boxes: "box", dozen: "dozen",
});
const UNIT_PATTERN = Object.keys(UNIT_ALIASES).sort((a, b) => b.length - a.length).join("|");

export function parseBusinessQuantity(value) {
  const match = String(value ?? "").trim().match(new RegExp("^([0-9]+(?:\\.[0-9]+)?)\\s*(" + UNIT_PATTERN + ")\\b", "i"));
  if (!match) return null;
  const quantity = Number(match[1]);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  return { quantity, unit: UNIT_ALIASES[match[2].toLowerCase()] };
}

const RULES = [
  { type: "create_invoice", pattern: /\\b(create|make|prepare|generate|bana(?:o|na)?|taiyar)\\b.{0,35}\\b(invoice|bill|invoic)\\b|\\b(invoice|bill)\\b.{0,35}\\b(create|make|bana(?:o|na)?)\\b|invoice\\s+(?:bana|banao|kar do)|इनवॉइस|चालान\\s+बना/iu },
  { type: "create_quotation", pattern: /\\b(create|make|prepare|bana(?:o|na)?)\\b.{0,35}\\b(quotation|quote|estimate)\\b|\\b(quotation|quote|estimate)\\b.{0,35}\\b(create|make|bana(?:o|na)?)\\b|कोटेशन\\s+बना/iu },
  { type: "create_client", pattern: /\\b(add|create|save|register|jod(?:o)?|bana(?:o|na)?|darj)\\b.{0,35}\\b(client|customer)\\b|\\b(client|customer)\\b.{0,35}\\b(add|create|save|jod(?:o)?)\\b|ग्राहक\\s+जोड़/iu },
  { type: "create_expense", pattern: /\\b(add|record|save|create|darj)\\b.{0,30}\\b(expense|kharcha|kharch)\\b|\\b(expense|kharcha|kharch)\\b.{0,30}\\b(add|record|save|create)\\b|खर्च\\s+दर्ज/iu },
  { type: "create_lead", pattern: /\\b(add|create|save|jod(?:o)?)\\b.{0,30}\\b(lead|prospect)\\b|\\b(lead|prospect)\\b.{0,30}\\b(add|create|save)\\b/iu },
  { type: "create_stock", pattern: /\\b(add|create|save|jod(?:o)?|bana(?:o)?)\\b.{0,35}\\b(stock item|inventory item|product)\\b|\\b(stock item|inventory item|product)\\b.{0,35}\\b(add|create|save)\\b|\\bstock\\s+mein\\s+(?:add|jod)/iu },
  { type: "create_purchase_order", pattern: /\\b(purchase order|po)\\b|\\b(order|mangwa(?:ya|i)|mangwaya)\\b.{0,35}\\b(stock|maal|goods|saman)\\b|\\b(stock|maal|goods|saman)\\b.{0,35}\\b(order|mangwa)/iu },
  { type: "receive_stock", pattern: /\\b(receive|received|receive[d]?|goods receipt|grn|stock received|maal aa gaya|maal mil gaya|stock aa gaya)\\b|माल\\s+(?:आ\\s+गया|मिल\\s+गया)/iu },
  { type: "create_warehouse", pattern: /\\b(add|create|open|bana(?:o)?)\\b.{0,30}\\b(warehouse|godown)\\b|\\b(warehouse|godown)\\b.{0,30}\\b(add|create|open|bana)/iu },
  { type: "stock_transfer", pattern: /\\b(transfer|move|shift)\\b.{0,40}\\b(stock|inventory|warehouse|godown)\\b|\\b(stock|inventory)\\b.{0,40}\\b(transfer|move|shift)\\b/iu },
  { type: "payment_incoming", pattern: /\\b(received|got|customer paid|payment received|paise mile|payment aaya|jama hua)\\b|पेमेंट\\s+मिला/iu },
  { type: "payment_outgoing", pattern: /\\b(paid|payment made|paid to|sent payment|paise diye|payment kiya)\\b|भुगतान\\s+किया/iu },
];

export function classifyBusinessIntents(value) {
  const source = String(value ?? "").normalize("NFKC").trim();
  if (!source) return [];
  const found = [];
  for (const rule of RULES) {
    if (rule.pattern.test(source)) found.push(rule.type);
  }
  return [...new Set(found)];
}

export function buildBusinessIntentHints(value) {
  const intents = classifyBusinessIntents(value);
  const quantity = parseBusinessQuantity(value);
  const amount = parseBusinessAmount(value);
  return {
    intents,
    quantity,
    amount,
    policy: "Advisory only: hints do not authorize or validate any write. Ask when the operation is ambiguous; use only server-allow-listed tools and require the normal confirmation flow.",
  };
}
