import { useEffect, useState } from "react";
import { History, Trash2, Eye } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import PageShell from "@/components/PageShell";
import { KEYS, loadList, removeItem, saveList } from "@/lib/stores";
import { backend, supabase } from "@/api/backendClient";

const sym = (c) => ({ INR: "₹", USD: "$", EUR: "€" }[c] || c);
const money = (v, c = "INR") => `${sym(c)} ${(Number(v) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateLabel = (v) => (v ? new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const reminderStage = { before_due_2: "2 days before due", due_date: "Due date", overdue_3: "3 days overdue", overdue_7: "7 days overdue", overdue_15: "15 days overdue" };
const reminderStatus = { scheduled: "Scheduled", on_hold: "Waiting for your confirmation", sending: "Sending", sent: "Sent", failed: "Failed", cancelled: "Cancelled" };

export default function InvoiceHistory() {
  const [items, setItems] = useState(() => loadList(KEYS.history, { includeCancelled: true }));
  const [view, setView] = useState(null);
  const [reminderEvents, setReminderEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [sendingEventId, setSendingEventId] = useState("");
  const [reminderMessage, setReminderMessage] = useState("");
  const [emailSavingId, setEmailSavingId] = useState("");
  useEffect(() => {
    let active = true;
    if (!view?.id) { setReminderEvents([]); return undefined; }
    setEventsLoading(true);
    supabase.from("invoice_reminder_events").select("id,stage,scheduled_for,status,sent_at,recipient_email,failure_reason")
      .eq("invoice_id", view.id).order("scheduled_for", { ascending: true })
      .then(({ data, error }) => {
        if (!active) return;
        setReminderEvents(error ? [] : (data || []));
        setEventsLoading(false);
      });
    return () => { active = false; };
  }, [view?.id]);
  const remove = (id) => { setItems(removeItem(KEYS.history, id)); if (view && view.id === id) setView(null); };
  const sendConfirmedReminder = async (event) => {
    if (!window.confirm("Please confirm: has the customer still NOT paid this invoice? The reminder email will be sent now.")) return;
    setSendingEventId(event.id); setReminderMessage("");
    try {
      const result = await backend.functions.invoke("confirmPaymentReminder", { eventId: event.id });
      if (!result?.data?.emailSent) throw new Error(result?.data?.error || "Reminder was not sent.");
      setReminderEvents((prev) => prev.map((item) => item.id === event.id ? { ...item, status: "sent", sent_at: new Date().toISOString() } : item));
      setReminderMessage("Reminder email sent successfully.");
    } catch (error) {
      setReminderMessage(error?.message || "Could not send reminder.");
      setReminderEvents((prev) => prev.map((item) => item.id === event.id ? { ...item, status: "failed" } : item));
    } finally { setSendingEventId(""); }
  };
  const updateItem = (id, patch) => {
    const next = items.map((it) => (it.id === id ? { ...it, ...patch } : it));
    saveList(KEYS.history, next);
    setItems(next);
    if (view && view.id === id) setView({ ...view, ...patch });
  };
  const addCustomerEmail = async (it) => {
    const entered = window.prompt("Enter the customer's email address:", reminderEmail(it) || "");
    if (entered === null) return;
    const email = entered.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      setReminderMessage("Please enter a valid customer email address.");
      return;
    }
    setEmailSavingId(it.id);
    setReminderMessage("");
    try {
      const result = await backend.functions.invoke("updateInvoiceClientEmail", { id: it.id, email });
      if (result?.error || result?.data?.error || result?.data?.ok !== true) throw new Error(result?.data?.error || result?.error?.message || "Could not save customer email.");
      const next = items.map((item) => item.id === it.id ? { ...item, clientEmail: email } : item);
      saveList(KEYS.history, next);
      setItems(next);
      if (view?.id === it.id) setView({ ...view, clientEmail: email });
      setReminderMessage("Customer email saved successfully. Auto Reminder can now be enabled.");
    } catch (error) {
      setReminderMessage(error?.message || "Could not save customer email.");
    } finally {
      setEmailSavingId("");
    }
  };
  // Automatic recipient mapping — pulled from the saved invoice record or client database, never typed manually.
  const reminderEmail = (it) => {
    if (it.clientEmail) return it.clientEmail;
    const match = loadList(KEYS.clients).find((c) => (c.name || "").toLowerCase() === (it.clientName || "").toLowerCase());
    return match?.email || "";
  };

  return (
    <PageShell icon={History} title="Invoice history" subtitle="Every invoice you've generated and saved to your workspace." >
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-10 text-center text-[13px] text-muted-foreground">No saved invoices yet. Generate and download an invoice from the desk to see it here.</div>
      ) : (
        <div className="space-y-3">
          {items.map((it) => (
            <div key={it.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2"><p className="font-mono-ui text-[10px] uppercase tracking-wider text-primary">{it.number || "INV-000"}</p><span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium">{it.itemCount || 0} items</span></div>
                <p className="mt-1 text-[14px] font-bold">{it.clientName || "Client"}</p>
                <p className="text-[11px] text-muted-foreground">{it.businessName || "—"} · {dateLabel(it.issueDate)}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2.5">
                  <label className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
                    <Switch checked={!!it.reminder?.enabled} disabled={!it.dueDate || !reminderEmail(it) || it.status === "Paid" || it.status === "Cancelled" || emailSavingId === it.id} onCheckedChange={async (v) => { setEmailSavingId(it.id); setReminderMessage(""); try { const result = await backend.functions.invoke("setInvoiceReminder", { id: it.id, enabled: v, language: it.reminder?.language || "en" }); if (result?.data?.ok !== true) throw new Error(result?.data?.error || "Reminder settings were not saved."); updateItem(it.id, { reminder: { ...it.reminder, enabled: v, language: it.reminder?.language || "en" } }); setReminderMessage(v ? "Auto Reminder enabled and schedule saved." : "Auto Reminder disabled."); } catch (error) { setReminderMessage(error?.message || "Could not save reminder settings."); } finally { setEmailSavingId(""); } }} />
                    Auto Reminder
                  </label>
                  {it.reminder?.enabled && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-muted-foreground">
                        Schedule: 2 days before, due date, 3, 7 & 15 days after · {reminderEmail(it) || "No customer email"}
                      </span>
                      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        Email language
                        <select aria-label="Reminder email language" className="rounded-md border bg-card px-2 py-1 text-[11px] text-foreground" value={it.reminder?.language || "en"} onChange={async (event) => { const language = event.target.value; try { const result = await backend.functions.invoke("setInvoiceReminder", { id: it.id, enabled: true, language }); if (result?.data?.ok !== true) throw new Error(result?.data?.error || "Could not save language."); updateItem(it.id, { reminder: { ...it.reminder, enabled: true, language } }); } catch (error) { setReminderMessage(error?.message || "Could not save reminder language."); } }}>
                          <option value="en">English</option>
                          <option value="hi">हिन्दी</option>
                        </select>
                      </label>
                    </div>
                  )}
                  {!reminderEmail(it) && <button type="button" onClick={() => addCustomerEmail(it)} disabled={emailSavingId === it.id} className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 disabled:opacity-50">{emailSavingId === it.id ? "Saving email…" : "Add customer email"}</button>}
                  {!it.dueDate && <span className="text-[11px] text-amber-700">Add a due date to enable reminders</span>}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <p className="text-[16px] font-bold tracking-[-0.03em]">{money(it.total, it.currency)}</p>
                <button onClick={() => setView(it)} className="rounded-lg border p-2 hover:bg-secondary" aria-label="View invoice"><Eye className="h-4 w-4" /></button>
                <button onClick={() => remove(it.id)} className="rounded-lg border p-2 text-destructive hover:bg-destructive/10" aria-label="Delete invoice"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      {view && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={() => setView(null)}>
          <div className="w-full max-w-[420px] rounded-2xl border bg-card p-5 text-card-foreground shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between"><div><p className="font-mono-ui text-[10px] uppercase tracking-wider text-primary">{view.number || "INV-000"}</p><h3 className="mt-1 text-lg font-bold">{view.clientName || "Client"}</h3></div><button onClick={() => setView(null)} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary">✕</button></div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-[12px]">
              <div><p className="text-muted-foreground">Business</p><p className="font-semibold">{view.businessName || "—"}</p></div>
              <div><p className="text-muted-foreground">Issue date</p><p className="font-semibold">{dateLabel(view.issueDate)}</p></div>
              <div><p className="text-muted-foreground">Items</p><p className="font-semibold">{view.itemCount || 0}</p></div>
              <div><p className="text-muted-foreground">Tax mode</p><p className="font-semibold">{view.taxMode === "split" ? "CGST + SGST" : "IGST"} ({view.taxRate || 0}%)</p></div>
              <div><p className="text-muted-foreground">CGST</p><p className="font-semibold">{money(view.cgst, view.currency)}</p></div>
              <div><p className="text-muted-foreground">SGST</p><p className="font-semibold">{money(view.sgst, view.currency)}</p></div>
              <div><p className="text-muted-foreground">IGST</p><p className="font-semibold">{money(view.igst, view.currency)}</p></div>
              <div><p className="text-muted-foreground">Total</p><p className="font-bold text-primary">{money(view.total, view.currency)}</p></div>
            </div>
            <section className="mt-5 border-t pt-4">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-bold">Payment reminder history</h4>
                <span className="text-[10px] text-muted-foreground">{view.reminder?.enabled ? "Automatic reminders ON" : "Reminders OFF"}</span>
              </div>
              {reminderMessage && <p className="mt-2 rounded-lg bg-secondary p-2 text-xs">{reminderMessage}</p>}
              {eventsLoading ? <p className="mt-3 text-xs text-muted-foreground">Loading reminder history…</p> : reminderEvents.length === 0 ? (
                <p className="mt-3 rounded-lg bg-secondary/60 p-3 text-xs text-muted-foreground">No reminder activity yet. Enable Auto Reminder to create a schedule.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {reminderEvents.map((event) => (
                    <div key={event.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold">{reminderStage[event.stage] || event.stage}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{dateLabel(event.scheduled_for)}</p>
                        {event.failure_reason && <p className="mt-1 text-[11px] text-destructive">{event.failure_reason}</p>}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${event.status === "sent" ? "bg-emerald-100 text-emerald-700" : event.status === "failed" ? "bg-red-100 text-red-700" : "bg-secondary text-muted-foreground"}`}>{reminderStatus[event.status] || event.status}</span>
                        {["on_hold", "scheduled", "failed"].includes(event.status) && event.scheduled_for <= new Date().toISOString().slice(0, 10) && (
                          <button onClick={() => sendConfirmedReminder(event)} disabled={!!sendingEventId} className="rounded-md bg-primary px-2 py-1 text-[10px] font-semibold text-primary-foreground disabled:opacity-50">
                            {sendingEventId === event.id ? "Sending…" : "Still unpaid · Send"}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </PageShell>
  );
}