import { KEYS, loadList, saveList } from "@/lib/stores";
import { parseBankStatementCsv, suggestReconciliationMatches } from "@/global/banking/reconciliation-engine.js";

export { parseBankStatementCsv as parseCSVStatement };

export function reconcileTransactions(transactions) {
  return suggestReconciliationMatches(transactions, loadList(KEYS.history), loadList(KEYS.expenses));
}

export function applyReconciliationMatches(result) {
  const invoices = loadList(KEYS.history);
  const expenses = loadList(KEYS.expenses);
  const appliedInvoiceIds = new Set();
  const appliedExpenseIds = new Set();
  let applied = 0;
  let totalReconciled = 0;
  const entries = result.entries.map((entry) => {
    if (entry.matchStatus !== "SUGGESTED") return entry;
    if (entry.matchedRecordType === "invoice") {
      const invoice = invoices.find((item) => item.id === entry.matchedRecordId);
      if (!invoice || appliedInvoiceIds.has(invoice.id) || invoice.isDraft || invoice.is_draft
        || !["pending", "overdue", ""].includes(String(invoice.status || "").toLowerCase())
        || Math.abs(Math.abs(Number(invoice.total || 0)) - Math.abs(Number(entry.amount || 0))) > 0.01) {
        return { ...entry, matchStatus: "SKIPPED_CHANGED" };
      }
      appliedInvoiceIds.add(invoice.id);
      invoice.status = "Paid";
      if (entry.utr) invoice.utrReference = entry.utr;
    } else if (entry.matchedRecordType === "expense") {
      const expense = expenses.find((item) => item.id === entry.matchedRecordId);
      if (!expense || appliedExpenseIds.has(expense.id)
        || !["unpaid", "pending", "overdue", ""].includes(String(expense.status || "").toLowerCase())
        || Math.abs(Math.abs(Number(expense.amount || 0)) - Math.abs(Number(entry.amount || 0))) > 0.01) {
        return { ...entry, matchStatus: "SKIPPED_CHANGED" };
      }
      appliedExpenseIds.add(expense.id);
      expense.status = "Paid";
    } else return { ...entry, matchStatus: "SKIPPED_CHANGED" };
    applied += 1;
    totalReconciled += Math.abs(Number(entry.amount || 0));
    return { ...entry, matchStatus: "APPLIED" };
  });
  if (appliedInvoiceIds.size) saveList(KEYS.history, invoices);
  if (appliedExpenseIds.size) saveList(KEYS.expenses, expenses);
  return { ...result, entries, applied, totalReconciled, matched: entries.filter((entry) => entry.matchStatus === "SUGGESTED").length };
}
