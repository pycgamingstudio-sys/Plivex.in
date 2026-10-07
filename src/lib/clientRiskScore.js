import { KEYS, loadList } from "@/lib/stores";

/**
 * Client Risk Scoring Algorithm (PDF Module 4)
 * Formula: 100-point reliability score with exponential delay penalty
 */
export function computeRiskScore(clientName) {
  const invoices = loadList(KEYS.history);
  const paymentLogs = loadList(KEYS.paymentLogs);

  const clientInvoices = invoices.filter(
    (it) => it.clientName === clientName && it.dueDate
  );
  if (clientInvoices.length === 0) return null;

  let totalDelayDays = 0;
  let defaultedCount = 0;
  let counted = 0;

  clientInvoices.forEach((inv) => {
    const paidLog = paymentLogs.find(
      (l) => l.invoiceNumber === inv.number && l.status === "paid"
    );
    const dueDate = new Date(inv.dueDate);
    if (!dueDate || isNaN(dueDate.getTime())) return;

    if (paidLog && paidLog.date) {
      const paidDate = new Date(paidLog.date);
      const delayDays = Math.floor((paidDate - dueDate) / 86400000);
      totalDelayDays += delayDays;
      counted++;
    } else if (inv.status === "Pending") {
      const today = new Date();
      const overdueBy = Math.floor((today - dueDate) / 86400000);
      if (overdueBy > 30) defaultedCount++;
    }
  });

  const D = counted > 0 ? totalDelayDays / counted : 0;

  let penalty = 0;
  if (D <= 0) penalty = 0;
  else if (D <= 7) penalty = D * 2;
  else if (D <= 30) penalty = 14 + (D - 7) * 2.5;
  else penalty = 71.5 + (D - 30) * 1.5;

  const score = Math.max(0, Math.min(100, Math.round(100 - penalty - defaultedCount * 25)));
  return score;
}

export function getRiskBadge(score) {
  if (score === null) return null;
  if (score >= 90) return { label: "FAST PAYER", color: "bg-emerald-500 text-white border border-emerald-600", pulse: false };
  if (score >= 70) return { label: "MODERATE PAYER", color: "bg-blue-500 text-white border border-blue-600", pulse: false };
  if (score >= 45) return { label: "DELAYED PAYER", color: "bg-orange-500 text-white border border-orange-600", pulse: false };
  return { label: "HIGH CREDIT RISK", color: "bg-red-500 text-white border border-red-600 animate-pulse", pulse: true };
}

export function getRiskAdvice(score) {
  if (score === null) return null;
  if (score >= 90) return "Allow extended payment terms (30–60 days)";
  if (score >= 70) return "Standard payment terms (15 days)";
  if (score >= 45) return "Send WhatsApp reminders on day 1";
  return "Require 50% advance before generating new invoice";
}