import { useState } from "react";
import { History, Trash2, Eye } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import PageShell from "@/components/PageShell";
import { KEYS, loadList, removeItem, saveList } from "@/lib/stores";

const sym = (c) => ({ INR: "₹", USD: "$", EUR: "€" }[c] || c);
const money = (v, c = "INR") => `${sym(c)} ${(Number(v) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateLabel = (v) => (v ? new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");

export default function InvoiceHistory() {
  const [items, setItems] = useState(() => loadList(KEYS.history, { includeCancelled: true }));
  const [view, setView] = useState(null);
  const remove = (id) => { setItems(removeItem(KEYS.history, id)); if (view && view.id === id) setView(null); };
  const updateItem = (id, patch) => {
    const next = items.map((it) => (it.id === id ? { ...it, ...patch } : it));
    saveList(KEYS.history, next);
    setItems(next);
    if (view && view.id === id) setView({ ...view, ...patch });
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
                    <Switch checked={!!it.reminder?.enabled} onCheckedChange={(v) => updateItem(it.id, { reminder: { enabled: v, intervalDays: it.reminder?.intervalDays ?? 7, lastSentDate: it.reminder?.lastSentDate } })} />
                    Auto Reminder
                  </label>
                  {it.reminder?.enabled && (
                    <span className="flex flex-wrap items-center gap-1 text-[11px] font-medium text-muted-foreground">
                      Send reminder
                      <input type="number" min="0" value={it.reminder.intervalDays ?? 7} onChange={(e) => updateItem(it.id, { reminder: { enabled: true, intervalDays: Math.max(0, Number(e.target.value) || 0), lastSentDate: it.reminder.lastSentDate } })} className="w-14 rounded-md border bg-card px-1.5 py-1 text-[11px]" aria-label="Reminder interval days" />
                      days after Issue Date · to {reminderEmail(it) || "no client email saved"}
                    </span>
                  )}
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
          </div>
        </div>
      )}
    </PageShell>
  );
}