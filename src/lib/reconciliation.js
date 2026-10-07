import { KEYS, loadList, saveList } from "@/lib/stores";

/**
 * Payment Reconciliation Engine (PDF Module 1)
 * Parses CSV bank statements and matches UTR / amount against pending invoices
 */

const UTR_REGEX = /\b([0-9]{12})\b/g;
const AMOUNT_REGEX = /(?:cr|credit|credit amount)[:\s]*([0-9,]+\.?[0-9]*)/gi;

function fuzzyMatch(a, b) {
  if (!a || !b) return 0;
  const s1 = a.toLowerCase().replace(/\s+/g, "");
  const s2 = b.toLowerCase().replace(/\s+/g, "");
  if (s1 === s2) return 100;
  let matches = 0;
  const shorter = s1.length < s2.length ? s1 : s2;
  const longer = s1.length < s2.length ? s2 : s1;
  for (let i = 0; i < shorter.length; i++) {
    if (longer.includes(shorter[i])) matches++;
  }
  return Math.round((matches / longer.length) * 100);
}

export function parseCSVStatement(csvText) {
  const lines = csvText.trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/"/g, ""));
  const dateIdx = headers.findIndex((h) => h.includes("date"));
  const narrationIdx = headers.findIndex((h) => h.includes("narration") || h.includes("description"));
  const amountIdx = headers.findIndex((h) => h.includes("credit") || h.includes("amount"));
  const utrIdx = headers.findIndex((h) => h.includes("utr") || h.includes("reference") || h.includes("ref"));

  return lines.slice(1).map((line) => {
    const cols = line.split(",").map((c) => c.trim().replace(/"/g, ""));
    const narration = cols[narrationIdx] || "";
    const utrMatches = narration.match(UTR_REGEX);
    return {
      date: cols[dateIdx] || "",
      narration,
      amount: parseFloat((cols[amountIdx] || "0").replace(/,/g, "")) || 0,
      utr: cols[utrIdx] || (utrMatches ? utrMatches[0] : ""),
    };
  }).filter((r) => r.amount > 0);
}

export function reconcileTransactions(transactions) {
  const invoices = loadList(KEYS.history);
  const results = { matched: 0, unmatched: 0, totalReconciled: 0, entries: [] };

  transactions.forEach((tx) => {
    // 1. Strict UTR match
    let matchedInvoice = tx.utr
      ? invoices.find((inv) => inv.utrReference === tx.utr && inv.status === "Pending")
      : null;

    // 2. Fuzzy: match by amount + client name similarity
    if (!matchedInvoice) {
      matchedInvoice = invoices.find((inv) => {
        if (inv.status !== "Pending") return false;
        const amountMatch = Math.abs(Number(inv.total || 0) - tx.amount) < 1;
        if (!amountMatch) return false;
        const similarity = fuzzyMatch(tx.narration, inv.clientName);
        return similarity >= 80;
      });
    }

    if (matchedInvoice) {
      // Update invoice status to Paid
      const updatedInvoices = invoices.map((inv) =>
        inv.id === matchedInvoice.id ? { ...inv, status: "Paid" } : inv
      );
      saveList(KEYS.history, updatedInvoices);
      results.matched++;
      results.totalReconciled += tx.amount;
      results.entries.push({ ...tx, matchStatus: "AUTOMATCHED", matchedInvoice: matchedInvoice.number });
    } else {
      results.unmatched++;
      results.entries.push({ ...tx, matchStatus: "UNMATCHED", matchedInvoice: null });
    }
  });

  return results;
}