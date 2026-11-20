const BUSINESS_CONTEXT_PATTERN = /\b(invoice|invoices|bill|billing|client|customer|grahak|stock|inventory|product|item|expense|kharcha|quotation|quote|lead|service|warehouse|supplier|purchase|receipt|payment|paid|received|reconciliation|ledger|balance|outstanding|sales|revenue|gst|tax|business|workspace|cash flow|profit|loss|accounting|reminder|activity)\b|ग्राहक|स्टॉक|माल|खर्च|बिल|इनवॉइस|भुगतान|गोदाम|खरीद|बकाया|बिक्री|जीएसटी|कर|व्यापार|कार्यक्षेत्र|लेखा/i;
const CONTINUATION_CUE = /^(?:aur|or|and|also|then|phir|overdue|pending|due|status|balance|total|amount|profit|loss|cash flow|sales|expenses|revenue|uska|uski|uske|isme|is mein|usmein|same|what about|how about|and what|aur batao|aur bataiye|kitna|kitne|kitni|kab|kaise|kyun|kyon|why|how much|how many|last month|previous month|pichhle|pichle|iss month|is month|that one|those|it|its|iska|iski|iske|haan|han|yes|no|nahi|nahin|continue|explain more)\b/i;
const ACKNOWLEDGEMENT = /^(?:hi|hello|hey|namaste|thanks|thank you|shukriya|ok|okay|great|cool|bye|good morning|good evening)[!\.\s]*$/i;

/**
 * Build a small routing-only context window for follow-up questions.
 * The model still receives the full bounded conversation separately.
 * This text is used only to decide which authorized workspace records to load.
 */
export function buildConversationRoutingText(messages, maxUserTurns = 4) {
  const userTurns = (Array.isArray(messages) ? messages : [])
    .filter((message) => message && message.role !== "assistant")
    .map((message) => String(message.content ?? "").trim().slice(0, 1200))
    .filter(Boolean)
    .slice(-Math.max(1, Math.min(6, Number(maxUserTurns) || 4)));

  if (!userTurns.length) return "";
  const latest = userTurns[userTurns.length - 1];
  if (ACKNOWLEDGEMENT.test(latest)) return latest;
  if (userTurns.length === 1) return latest;

  const previous = userTurns.slice(0, -1).join(" ");
  const isContinuation = CONTINUATION_CUE.test(latest)
    || (/^(?:overdue|pending|due|status|balance|total|amount)\\b/i.test(latest) && BUSINESS_CONTEXT_PATTERN.test(previous));

  return isContinuation ? userTurns.join("\n") : latest;
}

export function isBusinessContextFollowUp(messages) {
  return BUSINESS_CONTEXT_PATTERN.test(buildConversationRoutingText(messages));
}
