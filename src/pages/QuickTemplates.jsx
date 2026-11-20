import { useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { SUPPORTED_CURRENCIES, isSupportedCurrency } from "@/lib/currency";
import { useDialogA11y } from "@/lib/useDialogA11y";
import { LayoutTemplate, Plus, Trash2, ArrowRight, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import PageShell from "@/components/PageShell";
import { KEYS, loadList, saveList, genId, loadState, saveState } from "@/lib/stores";
import { inputCls, btnPrimary, btnGhost } from "@/lib/ui";

const blank = { name: "", taxRate: 18, currency: "INR", notes: "", terms: "" };

export default function QuickTemplates() {
  const { user } = useAuth();
  const isIndiaWorkspace = user?.country_code === "IN";
  const currencyCode = isSupportedCurrency(user?.currency_code) ? user.currency_code : "INR";
  const [templates, setTemplates] = useState(() => loadList(KEYS.templates));
  const [adding, setAdding] = useState(false);
  const navigate = useNavigate();
  const persist = (next) => { setTemplates(next); saveList(KEYS.templates, next); };
  const remove = (id) => persist(templates.filter((t) => t.id !== id));
  const use = (tpl) => {
    const draft = loadState(KEYS.draft, {});
    saveState(KEYS.draft, { ...draft, taxRate: tpl.taxRate, currency: tpl.currency, notes: tpl.notes, terms: tpl.terms });
    navigate("/");
  };

  return (
    <PageShell icon={LayoutTemplate} title="Quick templates" subtitle="Pre-filled designs for invoices you send often." action={<button onClick={() => setAdding(true)} className={btnPrimary}><Plus className="h-3.5 w-3.5" />New template</button>}>
      {templates.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-10 text-center text-[13px] text-muted-foreground">No templates yet. Create one for recurring invoice layouts.</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {templates.map((t) => (
            <div key={t.id} className="rounded-xl border bg-card p-4">
              <div className="flex items-start justify-between gap-2"><div><p className="text-[14px] font-bold">{t.name || "Untitled template"}</p><p className="text-[11px] text-muted-foreground">{isIndiaWorkspace ? "GST" : "Tax"} {t.taxRate}% · {t.currency}</p></div><button onClick={() => remove(t.id)} className="rounded-md p-1.5 text-destructive hover:bg-destructive/10" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button></div>
              {(t.notes || t.terms) && <div className="mt-2 space-y-1 text-[11px] text-muted-foreground"><p className="line-clamp-2"><span className="font-semibold">Note:</span> {t.notes || "—"}</p><p className="line-clamp-2"><span className="font-semibold">Terms:</span> {t.terms || "—"}</p></div>}
              <button onClick={() => use(t)} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border py-2 text-[11px] font-bold text-primary hover:bg-secondary">Use template <ArrowRight className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
      )}
      {adding && <TemplateModal onClose={() => setAdding(false)} onSave={(t) => { persist([{ ...t, id: genId("tpl") }, ...templates]); setAdding(false); }} currencyCode={currencyCode} isIndiaWorkspace={isIndiaWorkspace} />}
    </PageShell>
  );
}

function TemplateModal({ onClose, onSave, currencyCode, isIndiaWorkspace }) {
  const [form, setForm] = useState(() => ({ ...blank, currency: currencyCode, taxRate: isIndiaWorkspace ? 18 : 0 }));
  const dialogRef = useDialogA11y(true, onClose);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="template-dialog-title" tabIndex={-1} className="max-h-[min(88dvh,700px)] w-full max-w-[440px] overflow-y-auto overscroll-contain rounded-2xl border bg-card p-5 text-card-foreground shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 id="template-dialog-title" className="text-lg font-bold">New template</h3><button onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary"><X className="h-4 w-4" /></button></div>
        <div className="mt-4 grid gap-3">
          <label className="block text-[12px] font-semibold text-muted-foreground">Template name<input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Consulting retainer" /></label>
          <div className="grid grid-cols-2 gap-3">
            {isIndiaWorkspace ? <label className="block text-[12px] font-semibold text-muted-foreground">GST rate<select className={inputCls} value={form.taxRate} onChange={(e) => set("taxRate", Number(e.target.value))}>{[0, 5, 12, 18, 28].map((r) => <option key={r} value={r}>{r}%</option>)}</select></label> : <label className="block text-[12px] font-semibold text-muted-foreground">Tax rate (%)<input type="number" min="0" max="100" step="0.01" className={inputCls} value={form.taxRate} onChange={(e) => set("taxRate", Number(e.target.value))} /></label>}
            <label className="block text-[12px] font-semibold text-muted-foreground">Currency<select className={inputCls} value={form.currency} onChange={(e) => set("currency", e.target.value)}>{SUPPORTED_CURRENCIES.map((currency) => <option key={currency.code} value={currency.code}>{currency.label}</option>)}</select></label>
          </div>
          <label className="block text-[12px] font-semibold text-muted-foreground">Default note<textarea className={`${inputCls} min-h-[64px]`} value={form.notes} onChange={(e) => set("notes", e.target.value)} /></label>
          <label className="block text-[12px] font-semibold text-muted-foreground">Default terms<textarea className={`${inputCls} min-h-[64px]`} value={form.terms} onChange={(e) => set("terms", e.target.value)} /></label>
        </div>
        <div className="mt-4 flex justify-end gap-2"><button onClick={onClose} className={btnGhost}>Cancel</button><button onClick={() => onSave(form)} className={btnPrimary}>Save template</button></div>
      </div>
    </div>
  );
}