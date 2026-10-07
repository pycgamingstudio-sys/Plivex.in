import { useState } from "react";
import { CreditCard, Plus, Trash2, X } from "lucide-react";
import PageShell from "@/components/PageShell";
import { KEYS, loadList, saveList, genId } from "@/lib/stores";
import { inputCls, btnPrimary, btnGhost } from "@/lib/ui";

const sym = (c) => ({ INR: "₹", USD: "$", EUR: "€" }[c] || c);
const money = (v, c = "INR") => `${sym(c)} ${(Number(v) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATUS = { paid: "bg-emerald-100 text-emerald-700", pending: "bg-amber-100 text-amber-700", failed: "bg-red-100 text-red-700" };
const blank = { invoiceNumber: "", client: "", amount: "", status: "pending", date: new Date().toISOString().slice(0, 10) };

function Stat({ label, value, tone }) {
  const tones = { emerald: "text-emerald-600", amber: "text-amber-600", red: "text-red-600" };
  return <div className="rounded-xl border bg-card p-4"><p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p><p className={`mt-1 text-[20px] font-bold ${tones[tone]}`}>{value}</p></div>;
}

export default function PaymentLogs() {
  const [logs, setLogs] = useState(() => loadList(KEYS.paymentLogs));
  const [adding, setAdding] = useState(false);
  const persist = (next) => { setLogs(next); saveList(KEYS.paymentLogs, next); };
  const remove = (id) => persist(logs.filter((l) => l.id !== id));
  const cycle = (id, s) => persist(logs.map((l) => (l.id === id ? { ...l, status: s } : l)));
  const stats = {
    paid: logs.filter((l) => l.status === "paid").reduce((s, l) => s + Number(l.amount || 0), 0),
    pending: logs.filter((l) => l.status === "pending").length,
    failed: logs.filter((l) => l.status === "failed").length,
  };

  return (
    <PageShell icon={CreditCard} title="Payment logs" subtitle="Track payments received and outstanding." action={<button onClick={() => setAdding(true)} className={btnPrimary}><Plus className="h-3.5 w-3.5" />Log payment</button>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Received" value={money(stats.paid)} tone="emerald" />
        <Stat label="Pending" value={stats.pending} tone="amber" />
        <Stat label="Failed" value={stats.failed} tone="red" />
      </div>
      {logs.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-10 text-center text-[13px] text-muted-foreground">No payments logged yet.</div>
      ) : (
        <div className="rounded-xl border bg-card divide-y">
          {logs.map((l) => (
            <div key={l.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div><p className="text-[13px] font-bold">{l.invoiceNumber || "INV"} · {l.client || "Client"}</p><p className="text-[11px] text-muted-foreground">{l.date}</p></div>
              <div className="flex items-center gap-3">
                <p className="text-[14px] font-bold">{money(l.amount)}</p>
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${STATUS[l.status]}`}>{l.status}</span>
                <select value={l.status} onChange={(e) => cycle(l.id, e.target.value)} className="rounded-md border bg-background px-2 py-1 text-[11px]"><option value="paid">paid</option><option value="pending">pending</option><option value="failed">failed</option></select>
                <button onClick={() => remove(l.id)} className="rounded-md p-1.5 text-destructive hover:bg-destructive/10" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      {adding && <LogModal onClose={() => setAdding(false)} onSave={(entry) => { persist([{ ...entry, id: genId("pay"), amount: Number(entry.amount) || 0 }, ...logs]); setAdding(false); }} />}
    </PageShell>
  );
}

function LogModal({ onClose, onSave }) {
  const [form, setForm] = useState(blank);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-[440px] rounded-2xl border bg-card p-5 text-card-foreground shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="text-lg font-bold">Log a payment</h3><button onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary"><X className="h-4 w-4" /></button></div>
        <div className="mt-4 grid gap-3">
          <label className="block text-[12px] font-semibold text-muted-foreground">Invoice no.<input className={inputCls} value={form.invoiceNumber} onChange={(e) => set("invoiceNumber", e.target.value)} placeholder="INV-0001" /></label>
          <label className="block text-[12px] font-semibold text-muted-foreground">Client<input className={inputCls} value={form.client} onChange={(e) => set("client", e.target.value)} placeholder="Client name" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-[12px] font-semibold text-muted-foreground">Amount (₹)<input type="number" className={inputCls} value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0.00" /></label>
            <label className="block text-[12px] font-semibold text-muted-foreground">Status<select className={inputCls} value={form.status} onChange={(e) => set("status", e.target.value)}><option value="paid">paid</option><option value="pending">pending</option><option value="failed">failed</option></select></label>
          </div>
          <label className="block text-[12px] font-semibold text-muted-foreground">Date<input type="date" className={inputCls} value={form.date} onChange={(e) => set("date", e.target.value)} /></label>
        </div>
        <div className="mt-4 flex justify-end gap-2"><button onClick={onClose} className={btnGhost}>Cancel</button><button onClick={() => onSave(form)} className={btnPrimary}>Save log</button></div>
      </div>
    </div>
  );
}