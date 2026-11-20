import { useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { formatMoney, isSupportedCurrency } from "@/lib/currency";
import { useDialogA11y } from "@/lib/useDialogA11y";
import { Package, Plus, Pencil, Trash2, X } from "lucide-react";
import PageShell from "@/components/PageShell";
import { KEYS, loadList, saveList, genId } from "@/lib/stores";
import { inputCls, btnPrimary, btnGhost } from "@/lib/ui";

const blank = { name: "", rate: "", gstRate: 18, description: "" };

export default function ServiceCatalog() {
  const { user } = useAuth();
  const isIndiaWorkspace = user?.country_code === "IN";
  const currencyCode = isSupportedCurrency(user?.currency_code) ? user.currency_code : "INR";
  const taxLabel = isIndiaWorkspace ? "GST rate" : "Tax rate (%)";
  const [services, setServices] = useState(() => loadList(KEYS.services));
  const [editing, setEditing] = useState(null);
  const persist = (next) => { setServices(next); saveList(KEYS.services, next); };
  const remove = (id) => persist(services.filter((s) => s.id !== id));
  const save = (entry) => {
    if (!entry.name.trim()) return;
    const next = editing?.id ? services.map((s) => (s.id === editing.id ? { ...entry, id: editing.id } : s)) : [{ ...entry, id: genId("svc") }, ...services];
    persist(next); setEditing(null);
  };

  return (
    <PageShell icon={Package} title="Service catalog" subtitle="Save recurring services with preset prices for faster invoicing." action={<button onClick={() => setEditing({ ...blank, gstRate: isIndiaWorkspace ? 18 : 0 })} className={btnPrimary}><Plus className="h-3.5 w-3.5" />Add service</button>}>
      {services.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-10 text-center text-[13px] text-muted-foreground">No services saved yet.</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {services.map((s) => (
            <div key={s.id} className="rounded-xl border bg-card p-4">
              <div className="flex items-start justify-between gap-2"><div><p className="text-[14px] font-bold">{s.name}</p><p className="text-[11px] text-muted-foreground">{isIndiaWorkspace ? "GST" : "Tax"} {s.gstRate}%</p></div><div className="flex gap-1"><button onClick={() => setEditing({ ...s })} className="rounded-md p-1.5 hover:bg-secondary" aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></button><button onClick={() => remove(s.id)} className="rounded-md p-1.5 text-destructive hover:bg-destructive/10" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button></div></div>
              <p className="mt-2 text-[16px] font-bold text-primary">{formatMoney(Number(s.rate || 0), currencyCode)}</p>
              {s.description && <p className="mt-1 text-[11px] text-muted-foreground">{s.description}</p>}
            </div>
          ))}
        </div>
      )}
      {editing && <ServiceModal value={editing} onClose={() => setEditing(null)} onSave={save} currencyCode={currencyCode} isIndiaWorkspace={isIndiaWorkspace} taxLabel={taxLabel} />}
    </PageShell>
  );
}

function ServiceModal({ value, onClose, onSave, currencyCode, isIndiaWorkspace, taxLabel }) {
  const [form, setForm] = useState(value);
  const dialogRef = useDialogA11y(true, onClose);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="service-dialog-title" tabIndex={-1} className="max-h-[min(88dvh,700px)] w-full max-w-[440px] overflow-y-auto overscroll-contain rounded-2xl border bg-card p-5 text-card-foreground shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 id="service-dialog-title" className="text-lg font-bold">{value.id ? "Edit service" : "Add service"}</h3><button onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary"><X className="h-4 w-4" /></button></div>
        <div className="mt-4 grid gap-3">
          <label className="block text-[12px] font-semibold text-muted-foreground">Service name<input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Logo design" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-[12px] font-semibold text-muted-foreground">Rate ({currencyCode})<input type="number" className={inputCls} value={form.rate} onChange={(e) => set("rate", e.target.value)} placeholder="0.00" /></label>
            {isIndiaWorkspace ? <label className="block text-[12px] font-semibold text-muted-foreground">{taxLabel}<select className={inputCls} value={form.gstRate} onChange={(e) => set("gstRate", Number(e.target.value))}>{[0, 5, 12, 18, 28].map((r) => <option key={r} value={r}>{r}%</option>)}</select></label> : <label className="block text-[12px] font-semibold text-muted-foreground">{taxLabel}<input type="number" min="0" max="100" step="0.01" className={inputCls} value={form.gstRate} onChange={(e) => set("gstRate", Number(e.target.value))} /></label>}
          </div>
          <label className="block text-[12px] font-semibold text-muted-foreground">Description<textarea className={`${inputCls} min-h-[64px]`} value={form.description} onChange={(e) => set("description", e.target.value)} /></label>
        </div>
        <div className="mt-4 flex justify-end gap-2"><button onClick={onClose} className={btnGhost}>Cancel</button><button onClick={() => onSave(form)} className={btnPrimary}>Save service</button></div>
      </div>
    </div>
  );
}