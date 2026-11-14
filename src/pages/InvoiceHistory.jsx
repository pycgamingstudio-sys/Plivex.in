import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createRoot } from "react-dom/client";
import { InvoicePreview } from "./Home";
import { History, Trash2, Eye, Download } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import PageShell from "@/components/PageShell";
import { KEYS, loadList, removeItem, saveList, saveState } from "@/lib/stores";
import { backend, supabase } from "@/api/backendClient";

const sym = (c) => ({ INR: "₹", USD: "$", EUR: "€" }[c] || c);
const money = (v, c = "INR") => `${sym(c)} ${(Number(v) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateLabel = (v) => (v ? new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const reminderStage = { before_due_2: "2 days before due", due_date: "Due date", overdue_3: "3 days overdue", overdue_7: "7 days overdue", overdue_15: "15 days overdue" };
const reminderStatus = { scheduled: "Scheduled", on_hold: "Queued for automatic sending", sending: "Sending", sent: "Sent", failed: "Retry scheduled", cancelled: "Cancelled" };

export default function InvoiceHistory() {
  const navigate = useNavigate();
  const [items, setItems] = useState(() => loadList(KEYS.history, { includeCancelled: true }));
  const [view, setView] = useState(null);
  const [filter, setFilter] = useState("all");
  const [reminderEvents, setReminderEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [sendingEventId, setSendingEventId] = useState("");
  const [reminderMessage, setReminderMessage] = useState("");
  const [emailSavingId, setEmailSavingId] = useState("");
  const [downloadingId, setDownloadingId] = useState("");
  useEffect(() => {
    const refreshFromWorkspace = (event) => {
      if (!event?.detail?.keys || event.detail.keys.includes("history")) {
        setItems(loadList(KEYS.history, { includeCancelled: true }));
      }
    };
    window.addEventListener("plivex-workspace-data-updated", refreshFromWorkspace);
    return () => window.removeEventListener("plivex-workspace-data-updated", refreshFromWorkspace);
  }, []);
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
  const visibleItems = items.filter((item) => filter === "all" || (filter === "drafts" ? item.isDraft : !item.isDraft));
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
  const editDraft = (item) => {
    if (!item?.isDraft || !item.invoiceSnapshot || typeof item.invoiceSnapshot !== "object") return;
    const snapshot = {
      ...item.invoiceSnapshot,
      id: item.id,
      number: item.number || item.invoiceSnapshot.number || "",
      issueDate: item.issueDate || item.invoiceSnapshot.issueDate || "",
      dueDate: item.dueDate || item.invoiceSnapshot.dueDate || "",
      currency: item.currency || item.invoiceSnapshot.currency || "INR",
    };
    saveState("invoicepulse-draft", snapshot);
    setView(null);
    navigate("/");
  };
  const updateItem = (id, patch, sync = true) => {
    const next = items.map((it) => (it.id === id ? { ...it, ...patch } : it));
    saveList(KEYS.history, next, { sync });
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
      saveList(KEYS.history, next, { sync: false });
      setItems(next);
      if (view?.id === it.id) setView({ ...view, clientEmail: email });
      setReminderMessage("Customer email saved successfully. Auto Reminder can now be enabled.");
    } catch (error) {
      setReminderMessage(error?.message || "Could not save customer email.");
    } finally {
      setEmailSavingId("");
    }
  };
  const downloadOldInvoice = async (it) => {
    if (downloadingId) return;
    setDownloadingId(it.id);
    let root;
    let stage;
    try {
      const saved = it.invoiceSnapshot;
      const hasOriginalSnapshot = saved && typeof saved === "object" && saved.business && saved.client && Array.isArray(saved.items);
      const invoice = hasOriginalSnapshot ? {
        ...saved,
        number: it.number || saved.number || "INV-000",
        issueDate: it.issueDate || saved.issueDate || "",
        dueDate: it.dueDate || saved.dueDate || "",
        currency: it.currency || saved.currency || "INR",
        items: saved.items,
        design: saved.design || "classic",
      } : {
        business: { name: it.businessName || "", email: "", phone: "", gstin: "", address: "" },
        client: { name: it.clientName || "", company: "", email: it.clientEmail || "", phone: "", gstin: "", address: "" },
        number: it.number || "INV-000",
        issueDate: it.issueDate || "",
        dueDate: it.dueDate || "",
        currency: it.currency || "INR",
        items: (it.items || []).map((item, index) => ({ ...item, id: item.id || `history-item-${index}` })),
        taxRate: Number(it.taxRate) || 0,
        taxMode: it.taxMode || "split",
        discountType: it.discountType || "percent",
        discount: Number(it.discount) || 0,
        notes: it.notes || "",
        terms: it.terms || "",
        design: "classic",
      };
      const supportedDesigns = new Set(["classic", "modern", "minimal", "executive", "elegant"]);
      const design = supportedDesigns.has(invoice.design) ? invoice.design : "classic";

      stage = document.createElement("div");
      stage.style.cssText = "position:fixed;left:0;top:0;width:826px;z-index:-1;pointer-events:none;background:#fff;";
      document.body.appendChild(stage);
      root = createRoot(stage);
      root.render(<InvoicePreview invoice={invoice} design={design} />);

      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (document.fonts?.ready) await document.fonts.ready;
      const source = stage.querySelector("[data-testid='invoice-preview']");
      if (!source) throw new Error("Original invoice preview could not be rendered.");
      await Promise.all([...source.querySelectorAll("img")].map((img) => img.decode?.().catch(() => undefined)));
      const qrImage = source.querySelector('img[alt="UPI payment QR code"]');
      if (qrImage && !qrImage.naturalWidth) throw new Error("UPI QR image could not be loaded. Check your connection and retry the PDF.");
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
      const canvas = await html2canvas(source, {
        // 2x A4 raster is roughly 190 DPI: crisp for invoices/QR while
        // reducing mobile canvas memory and rasterization work versus 3x.
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false,
        windowWidth: 826,
        imageTimeout: 5000,
      });
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
      pdf.setProperties({
        title: `Plivex Invoice ${invoice.number || ""}`,
        subject: "Historical invoice copy",
        creator: "Plivex — Smart Invoicing & Business OS",
        author: "Plivex",
      });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const marginX = 7;
      const marginTop = 7;
      const marginBottom = 12;
      // Historical downloads also stay on one physical A4 page.
      const fitScale = Math.min((pageWidth - marginX * 2) / canvas.width, (pageHeight - marginTop - marginBottom) / canvas.height);
      const fittedWidth = canvas.width * fitScale;
      const fittedHeight = canvas.height * fitScale;
      const x = (pageWidth - fittedWidth) / 2;
      const y = marginTop + Math.max(0, (pageHeight - marginTop - marginBottom - fittedHeight) / 2);
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", x, y, fittedWidth, fittedHeight, undefined, "FAST");
      const pageCount = pdf.getNumberOfPages();
      for (let page = 1; page <= pageCount; page += 1) {
        pdf.setPage(page);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(7);
        pdf.setTextColor(120);
        pdf.text(`Page ${page} of ${pageCount}`, pageWidth - 8, pageHeight - 4, { align: "right" });
      }
      pdf.save(`Plivex_${String(invoice.number || "INV-000").replace(/[^a-zA-Z0-9]+/g, "-")}.pdf`);
      if (!hasOriginalSnapshot) {
        setReminderMessage("This older invoice did not contain a saved design snapshot, so it was rebuilt using Plivex Classic. New invoices will retain their exact original design.");
      }
    } catch (error) {
      setReminderMessage(error?.message || "Could not download this invoice.");
    } finally {
      root?.unmount();
      if (stage?.parentNode) stage.parentNode.removeChild(stage);
      setDownloadingId("");
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
      {reminderMessage && <div role="status" aria-live="polite" className="mb-3 rounded-lg border bg-card px-3 py-2 text-xs text-foreground">{reminderMessage}</div>}
      {items.length > 0 && <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Invoice type filters">
        {[["all","All invoices"],["drafts","Drafts"],["final","Final invoices"]].map(([value,label]) => <button key={value} role="tab" aria-selected={filter === value} onClick={() => setFilter(value)} className={`rounded-full border px-3 py-2 text-xs font-semibold ${filter === value ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-secondary"}`}>{label}{value === "drafts" ? ` (${items.filter((item) => item.isDraft).length})` : value === "final" ? ` (${items.filter((item) => !item.isDraft).length})` : ` (${items.length})`}</button>)}
      </div>}
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-10 text-center text-[13px] text-muted-foreground">No saved invoices yet. Generate and download an invoice from the desk to see it here.</div>
      ) : (
        visibleItems.length === 0 ? <div className="rounded-xl border border-dashed bg-card p-8 text-center text-[13px] text-muted-foreground">{filter === "drafts" ? "No invoice drafts yet. AI-prepared and saved drafts will appear here." : "No invoices in this filter."}</div> : <div className="space-y-3">
          {visibleItems.map((it) => (
            <div key={it.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2"><p className="font-mono-ui text-[10px] uppercase tracking-wider text-primary">{it.number || "INV-000"}</p><span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium">{it.itemCount || 0} items</span>{it.isDraft && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">Draft · Not issued</span>}</div>
                <p className="mt-1 text-[14px] font-bold">{it.clientName || "Client"}</p>
                <p className="text-[11px] text-muted-foreground">{it.businessName || "—"} · {dateLabel(it.issueDate)}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2.5">
                  <label className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
                    <Switch checked={!!it.reminder?.enabled} disabled={!it.dueDate || !reminderEmail(it) || it.status === "Paid" || it.status === "Cancelled" || emailSavingId === it.id} onCheckedChange={async (v) => { setEmailSavingId(it.id); setReminderMessage(""); try { const result = await backend.functions.invoke("setInvoiceReminder", { id: it.id, enabled: v, language: it.reminder?.language || "en" }); if (result?.data?.ok !== true) throw new Error(result?.data?.error || "Reminder settings were not saved."); updateItem(it.id, { reminder: { ...it.reminder, enabled: v, language: it.reminder?.language || "en" } }, false); setReminderMessage(v ? "Auto Reminder enabled and schedule saved." : "Auto Reminder disabled."); } catch (error) { setReminderMessage(error?.message || "Could not save reminder settings."); } finally { setEmailSavingId(""); } }} />
                    Auto Reminder
                  </label>
                  {it.reminder?.enabled && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-muted-foreground">
                        Automatic email schedule: 2 days before, due date, 3, 7 & 15 days after · {reminderEmail(it)}
                      </span>
                      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        Email language
                        <select aria-label="Reminder email language" className="rounded-md border bg-card px-2 py-1 text-[11px] text-foreground" value={it.reminder?.language || "en"} onChange={async (event) => { const language = event.target.value; try { const result = await backend.functions.invoke("setInvoiceReminder", { id: it.id, enabled: true, language }); if (result?.data?.ok !== true) throw new Error(result?.data?.error || "Could not save language."); updateItem(it.id, { reminder: { ...it.reminder, enabled: true, language } }, false); } catch (error) { setReminderMessage(error?.message || "Could not save reminder language."); } }}>
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
                <button onClick={() => setView(it)} className="rounded-lg border p-2 hover:bg-secondary" aria-label="View invoice"><Eye className="h-4 w-4" /></button>\n                <button onClick={() => downloadOldInvoice(it)} disabled={!!downloadingId} className="rounded-lg border p-2 text-primary hover:bg-secondary disabled:opacity-50" aria-label="Download old invoice PDF" title="Download PDF"><Download className="h-4 w-4" /></button>
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
            {view.isDraft && view.invoiceSnapshot && <button onClick={() => editDraft(view)} className="mt-4 w-full rounded-lg bg-primary px-3 py-2.5 text-xs font-semibold text-primary-foreground">Edit draft</button>}
            <div className="mt-4 grid grid-cols-2 gap-3 text-[12px]">
              <div><p className="text-muted-foreground">Business</p><p className="font-semibold">{view.businessName || "—"}</p></div>
              <div><p className="text-muted-foreground">Issue date</p><p className="font-semibold">{dateLabel(view.issueDate)}</p></div>
              <div><p className="text-muted-foreground">Items</p><p className="font-semibold">{view.itemCount || 0}</p></div>
              {view.invoiceSnapshot?.globalTax?.countryCode && view.invoiceSnapshot.globalTax.countryCode !== "IN" ? <>
                <div><p className="text-muted-foreground">Tax format</p><p className="font-semibold">{view.invoiceSnapshot.globalTax.countryCode} · {view.invoiceSnapshot.globalTaxCalculation?.status === "manual_unverified" ? "Manual / unverified" : view.invoiceSnapshot.globalTaxCalculation?.status || "Needs review"}</p></div>
                <div><p className="text-muted-foreground">Tax amount</p><p className="font-semibold">{money(view.taxValue, view.currency)}</p></div>
              </> : <>
                <div><p className="text-muted-foreground">Tax mode</p><p className="font-semibold">{view.taxMode === "split" ? "CGST + SGST" : "IGST"} ({view.taxRate || 0}%)</p></div>
                <div><p className="text-muted-foreground">CGST</p><p className="font-semibold">{money(view.cgst, view.currency)}</p></div>
                <div><p className="text-muted-foreground">SGST</p><p className="font-semibold">{money(view.sgst, view.currency)}</p></div>
                <div><p className="text-muted-foreground">IGST</p><p className="font-semibold">{money(view.igst, view.currency)}</p></div>
              </>}
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