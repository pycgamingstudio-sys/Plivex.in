/**
 * Deterministic, advisory business-intent hints for Plivex AI.
 * These hints never authorize writes; server validators and confirmation remain authoritative.
 */
const AMOUNT_RE = /^\s*(?:₹|rs\.?\s*|inr\s*)?([0-9][0-9,]*(?:\.[0-9]+)?)\s*(k|thousand|lakh|lac|cr|crore)?\s*$/i;
const MULTIPLIERS = Object.freeze({ k: 1000, thousand: 1000, lakh: 100000, lac: 100000, cr: 10000000, crore: 10000000 });

export function parseBusinessAmount(value) {
  const source = String(value ?? "").normalize("NFKC").trim();
  const match = source.match(AMOUNT_RE)
    || source.match(/(?:₹|rs\.?\s*|inr\s*)([0-9][0-9,]*(?:\.[0-9]+)?)\s*(k|thousand|lakh|lac|cr|crore)?/i)
    || source.match(/(?:rate|price|amount|total|rakam|keemat|kimat|daam|रकम|कीमत|दाम)\s*(?:is|hai|है|[:=])?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(k|thousand|lakh|lac|cr|crore)?/i)
    || source.match(/([0-9][0-9,]*(?:\.[0-9]+)?)\s*(k|thousand|lakh|lac|cr|crore)\b/i);
  if (!match) return null;
  const base = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(base) || base < 0) return null;
  const amount = base * (MULTIPLIERS[String(match[2] || "").toLowerCase()] || 1);
  return Number.isSafeInteger(Math.round(amount * 100)) ? amount : null;
}

const UNIT_ALIASES = Object.freeze({
  kg: "kg", kgs: "kg", kilo: "kg", kilos: "kg", kilogram: "kg", kilograms: "kg",
  g: "g", gm: "g", gram: "g", grams: "g",
  l: "litre", lt: "litre", ltr: "litre", litre: "litre", liter: "litre", liters: "litre", litres: "litre",
  pc: "pcs", pcs: "pcs", piece: "pcs", pieces: "pcs", packet: "packet", packets: "packet",
  box: "box", boxes: "box", dozen: "dozen",
});

export function parseBusinessQuantity(value) {
  const match = String(value ?? "").normalize("NFKC").trim().match(/([0-9]+(?:\.[0-9]+)?)\s*(kilograms|kilogram|kilos|kilo|kgs|kg|grams|gram|gm|g|liters|litres|liter|litre|ltr|lt|l|pieces|piece|pcs|pc|packets|packet|boxes|box|dozen)\b/i);
  if (!match) return null;
  const quantity = Number(match[1]);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  return { quantity, unit: UNIT_ALIASES[match[2].toLowerCase()] };
}

const RULES = [
  { type: "create_invoice", pattern: /\b(create|make|prepare|generate|issue|draft|bana(?:o|na)?|taiyar|nikal(?:o)?|bnao)\b.{0,55}\b(invoice|bill|invoic|tax invoice)\b|\b(invoice|bill|invoic)\b.{0,55}\b(create|make|prepare|generate|bana(?:o|na)?|taiyar)\b|invoice\s+(?:bana|banao|kar do)|इनवॉइस|चालान\s*(?:बना|तैयार)|बिल\s*बना/iu },
  { type: "create_quotation", pattern: /\b(create|make|prepare|generate|draft|bana(?:o|na)?)\b.{0,55}\b(quotation|quote|estimate|proposal)\b|\b(quotation|quote|estimate|proposal)\b.{0,55}\b(create|make|prepare|generate|bana(?:o|na)?)\b|कोटेशन\s*(?:बना|तैयार)|अनुमान\s*बना/iu },
  { type: "create_client", pattern: /\b(add|create|save|register|insert|new|jod(?:o|na)?|bana(?:o|na)?|darj|likh(?:o)?|rakh(?:o)?)\b.{0,55}\b(client|customer|buyer|grahak|customer detail)\b|\b(client|customer|buyer|grahak)\b.{0,55}\b(add|create|save|register|jod(?:o|na)?|bana(?:o|na)?)\b|ग्राहक\s*(?:जोड़|बना|दर्ज)|नया\s*कस्टमर/iu },
  { type: "create_expense", pattern: /\b(add|record|save|create|log|enter|book|note|darj|likh(?:o)?|jod(?:o)?)\b.{0,45}\b(expense|kharcha|kharch|spend|outgoing payment|business cost)\b|\b(expense|kharcha|kharch|business cost)\b.{0,45}\b(add|record|save|create|log|enter|book|darj|likh(?:o)?|jod(?:o)?)\b|खर्च\s*(?:दर्ज|जोड़|लिख)|व्यय\s*दर्ज/iu },
  { type: "create_lead", pattern: /\b(add|create|save|register|capture|jod(?:o|na)?)\b.{0,45}\b(lead|prospect|enquiry|inquiry|potential customer)\b|\b(lead|prospect|enquiry|inquiry)\b.{0,45}\b(add|create|save|capture|jod(?:o)?)\b|नई\s*(?:लीड|पूछताछ)/iu },
  { type: "create_stock", pattern: /\b(add|create|save|jod(?:o|na)?|bana(?:o)?|list|register|enter)\b.{0,50}\b(stock item|inventory item|product|item master|new item|product item)\b|\b(stock item|inventory item|product|item master|new item)\b.{0,50}\b(add|create|save|jod(?:o)?|register|list|enter)\b|\bstock\s+(?:mein|me)\s+(?:add|jod)|inventory\s+mein\s+add|नया\s*(?:प्रोडक्ट|सामान)|माल\s*की\s*एंट्री/iu },
  { type: "create_purchase_order", pattern: /\b(create|make|prepare|generate|draft|raise|place|new|bana(?:o|na)?|mangwa(?:ya|i|o)?)\b.{0,55}\b(purchase order|po|buying order|supplier order)\b|\b(purchase order|po|buying order|supplier order)\b.{0,55}\b(create|make|prepare|generate|draft|raise|place|bana(?:o|na)?)\b|\b(order|mangwa(?:ya|i|o)?|mangwaya|purchase|procure)\b.{0,55}\b(stock|maal|goods|saman|items|products|supplier)\b|\b(stock|maal|goods|saman|items|products)\b.{0,55}\b(order|mangwa|purchase|procure)\b|खरीद\s*(?:ऑर्डर|आर्डर)|माल\s*(?:मंगवा|ऑर्डर)/iu },
  { type: "receive_stock", pattern: /\b(receive|received|accept|book in|record)\s+(?:(?:the|a|some)\s+)?(?:stock|goods|inventory|items|maal)\b|\b(stock|goods|inventory|items|maal)\s+(?:receive|received|accept|book in|record)\b|\b(goods receipt|grn|stock received|received stock|maal aa gaya|maal mil gaya|stock aa gaya|delivery received)\b|माल\s*(?:आ\s*गया|मिल\s*गया|प्राप्त)|स्टॉक\s*(?:मिल|आ)\s*गया/iu },
  { type: "create_warehouse", pattern: /\b(add|create|open|register|set up|bana(?:o)?|jod(?:o)?)\b.{0,45}\b(warehouse|godown|stockroom|store room)\b|\b(warehouse|godown|stockroom|store room)\b.{0,45}\b(add|create|open|register|set up|bana|jod)\b|गोदाम\s*(?:बना|जोड़|खोल)|नया\s*वेयरहाउस/iu },
  { type: "stock_transfer", pattern: /\b(transfer|move|shift|send|relocate)\b.{0,55}\b(stock|inventory|warehouse|godown|items)\b|\b(stock|inventory|items)\b.{0,55}\b(transfer|move|shift|relocate|send)\b|स्टॉक\s*(?:ट्रांसफर|भेज)|माल\s*(?:दूसरे गोदाम|एक गोदाम)/iu },
  { type: "payment_incoming", pattern: /\b(customer paid|payment received|received payment|money received|amount received|got paid|paise mile|payment aaya|payment aa gaya|jama hua|credit received)\b|पेमेंट\s*(?:मिला|आया)|पैसे\s*(?:मिले|आए)|रकम\s*जमा/iu },
  { type: "payment_outgoing", pattern: /\b(paid|payment made|paid to|sent payment|money sent|amount paid|i paid|we paid|paise diye|payment kiya|debit paid)\b|भुगतान\s*(?:किया|दिया)|पैसे\s*(?:दिए|भेजे)/iu },
  { type: "invite_supplier", pattern: /\b(invite|add|create|save|register|new)\b.{0,45}\b(supplier|vendor)\b|\b(supplier|vendor)\b.{0,45}\b(invite|add|create|save|register|new)\b|नया\s*(?:सप्लायर|विक्रेता)\s*(?:जोड़|आमंत्रित)/iu },
  { type: "invite_staff", pattern: /\b(invite|add|create|register|hire|onboard)\b.{0,45}\b(staff|employee|worker|team member)\b|\b(staff|employee|worker)\b.{0,45}\b(invite|add|create|register|hire|onboard)\b|कर्मचारी\s*(?:जोड़|रख)|स्टाफ\s*जोड़/iu },
  { type: "create_branch", pattern: /\b(add|create|open|register)\b.{0,45}\b(branch|outlet|location)\b|\b(branch|outlet)\b.{0,45}\b(add|create|open|register)\b|नई\s*(?:ब्रांच|शाखा)/iu },
  { type: "automation", pattern: /\b(automate|schedule|set up|create)\b.{0,45}\b(reminder|recurring|workflow|automation|follow.?up)\b|\b(reminder|workflow|automation)\b.{0,45}\b(automate|schedule|set up|create)\b|ऑटोमेट|रिमाइंडर\s*लग/iu },
];

export function classifyBusinessIntents(value) {
  const source = String(value ?? "").normalize("NFKC").replace(/[’‘]/g, "'").trim();
  if (!source) return [];
  const found = [];
  for (const rule of RULES) if (rule.pattern.test(source)) found.push(rule.type);
  return [...new Set(found)];
}

export function buildBusinessIntentHints(value) {
  const source = String(value ?? "").normalize("NFKC").trim();
  const intents = classifyBusinessIntents(source);
  const quantity = parseBusinessQuantity(source);
  const amount = parseBusinessAmount(source);
  const ambiguities = [];
  if (quantity && !intents.some((intent) => ["create_stock", "create_purchase_order", "receive_stock", "stock_transfer"].includes(intent))) {
    ambiguities.push({
      field: "inventory_operation",
      question: "Is this a new product, a purchase order, or stock received for an existing product?",
      reason: "A quantity alone does not identify the intended inventory operation.",
    });
  }
  if (intents.includes("create_purchase_order") && intents.includes("receive_stock")) {
    ambiguities.push({
      field: "purchase_lifecycle",
      question: "Do you want to create a purchase order, record goods already received, or both in that order?",
      reason: "Ordering and receiving are separate business events.",
    });
  }
  return {
    intents, quantity, amount, ambiguities,
    policy: "Advisory only: hints do not authorize or validate any write. Ask when the operation is ambiguous; use only server-allow-listed tools and require the normal confirmation flow.",
  };
}
