import { backend as db } from '@/api/backendClient';


import { KEYS, loadList, saveList, loadState } from "@/lib/stores";

// Automatic recipient mapping — pulled from the saved invoice record or the client
// database. The user is never prompted to type or confirm an email.
const reminderRecipient = (it) => {
  if (it.clientEmail) return it.clientEmail;
  const match = loadList(KEYS.clients).find((c) => (c.name || "").toLowerCase() === (it.clientName || "").toLowerCase());
  return match?.email || "";
};

// Sweeps unpaid invoices with Auto Reminder enabled and sends a reminder email once
// per day once CURRENT_DATE >= issue_date + interval_days. Runs as a best-effort
// client-side scheduler (true cron needs scheduled workflows on a paid plan).
export async function processDueReminders() {
  // Automatic reminders are switched off until the server-side reminder job is built.
  return false;
  // eslint-disable-next-line no-unreachable
  const today = new Date().toISOString().slice(0, 10);
  const es = loadState("invoicepulse:emailSettings", {});
  const list = loadList(KEYS.history);
  let changed = false;

  for (const it of list) {
    const r = it.reminder;
    if (!r?.enabled) continue;
    if (it.status === "Paid") continue;
    const days = Math.max(0, Number(r.intervalDays) || 0);
    const due = new Date(it.issueDate || it.createdDate || today);
    due.setDate(due.getDate() + days);
    if (today < due.toISOString().slice(0, 10)) continue; // not due yet
    if (r.lastSentDate === today) continue;                // already sent today
    const to = reminderRecipient(it);
    if (!to) continue;
    try {
      await db.functions.invoke("sendPaymentReminder", {
        to,
        clientName: it.clientName,
        invoiceNumber: it.number,
        amount: `₹${(Number(it.total) || 0).toLocaleString("en-IN")}`,
        senderEmail: es.senderEmail,
        appPassword: es.appPassword,
      });
      it.reminder = { ...r, lastSentDate: today };
      changed = true;
    } catch { /* failed send — retried on the next sweep */ }
  }

  if (changed) saveList(KEYS.history, list);
  return changed;
}