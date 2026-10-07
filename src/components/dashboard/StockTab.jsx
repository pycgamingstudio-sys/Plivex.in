import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, X, Search, RotateCcw, Package, AlertTriangle, Boxes, TrendingDown } from "lucide-react";
import { KEYS, loadList, saveList, genId } from "@/lib/stores";
import { inputCls, btnGhost } from "@/lib/ui";
import { btnAccent, Empty } from "@/lib/dashboardData";
import SummaryCard from "@/components/dashboard/SummaryCard";

const DEFAULT_LOW = 5;
const blank = { name: "", sku: "", quantity: "", unit: "units", price: "", lowStock: String(DEFAULT_LOW) };

export default function StockTab() {
  const [items, setItems] = useState(() => loadList(KEYS.stock));
  const [open, setOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [q, setQ] = useState("");

  useEffect(() => { saveList(KEYS.stock, items); }, [items]);

  const filtered = useMemo(() => items.filter((p) => `${p.name} ${p.sku || ""}`.toLowerCase().includes(q.toLowerCase())), [items, q]);
  const lowCount = items.filter((p) => (Number(p.quantity) || 0) <= (Number(p.lowStock) || DEFAULT_LOW)).length;
  const totalUnits = items.reduce((s, p) => s + (Number(p.quantity) || 0), 0);

  const isLow = (p) => (Number(p.quantity) || 0) <= (Number(p.lowStock) || DEFAULT_LOW);

  const remove = (id) => setItems((prev) => prev.filter((p) => p.id !== id));
  const save = (entry) => {
    if (!entry.name.trim()) return;
    if (editTarget) {
      setItems((prev) => prev.map((p) => (p.id === editTarget.id ? { ...editTarget, ...entry } : p)));
      setEditTarget(null);
    } else {
      setItems((prev) => [{ ...entry, id: genId("stk"), quantity: Number(entry.quantity) || 0 }, ...prev]);
    }
    setOpen(false);
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard label="Total Products" value={String(items.length)} gradient="bg-gradient-to-br from-[#6D28D9] to-[#7C3AED]" icon={Boxes} badge="SKUs" />
        <SummaryCard label="Units in Stock" value={String(totalUnits)} gradient="bg-gradient-to-br from-[#059669] to-[#10B981]" icon={Package} badge="quantity" />
        <SummaryCard label="Low Stock Alerts" value={String(lowCount)} gradient={lowCount > 0 ? "bg-gradient-to-br from-[#E11D48] to-[#F43F5E]" : "bg-gradient-to-br from-[#6D28D9] to-[#7C3AED]"} icon={AlertTriangle} badge={lowCount > 0 ? "restock soon" : "all good"} />
      </div>

      <div className="rounded-2xl border border-[#E5E7EB] bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-[#E5E7EB] p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative max-w-xs flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products…" className={`${inputCls} pl-9`} />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setQ("")} className="flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] px-2.5 py-2 text-[11px] font-semibold text-slate-500 hover:bg-slate-50"><RotateCcw className="h-3.5 w-3.5" />Reset</button>
            <button onClick={() => { setEditTarget(null); setOpen(true); }} className={btnAccent}><Plus className="h-3.5 w-3.5" />Add product</button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <Empty label="No products in stock yet. Add your first product to enable auto-deduction on invoices." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[12px]">
              <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-2.5">Product</th>
                  <th className="px-4 py-2.5">SKU</th>
                  <th className="px-4 py-2.5 text-right">Quantity</th>
                  <th className="px-4 py-2.5 text-right">Low-stock at</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {filtered.map((p) => {
                  const low = isLow(p);
                  return (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-bold text-slate-900">{p.name}</td>
                      <td className="px-4 py-3 text-slate-500">{p.sku || "—"}</td>
                      <td className="px-4 py-3 text-right font-bold text-slate-900">{Number(p.quantity) || 0} <span className="font-normal text-slate-400">{p.unit}</span></td>
                      <td className="px-4 py-3 text-right text-slate-500">{Number(p.lowStock) || DEFAULT_LOW}</td>
                      <td className="px-4 py-3">
                        {low ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-1 text-[10px] font-bold uppercase text-rose-700"><AlertTriangle className="h-3 w-3" />Low Stock Alert</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold uppercase text-emerald-700">In stock</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <button onClick={() => { setEditTarget(p); setOpen(true); }} className="rounded-lg border border-[#E5E7EB] p-1.5 text-slate-500 hover:bg-slate-50" aria-label="Edit product"><Pencil className="h-3.5 w-3.5" /></button>
                          <button onClick={() => remove(p.id)} className="rounded-lg border border-[#E5E7EB] p-1.5 text-red-500 hover:bg-red-50" aria-label="Delete product"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {open && (
        <ProductModal
          value={editTarget ? { ...blank, ...editTarget, quantity: String(editTarget.quantity ?? ""), lowStock: String(editTarget.lowStock ?? DEFAULT_LOW) } : blank}
          isEdit={Boolean(editTarget)}
          onClose={() => { setOpen(false); setEditTarget(null); }}
          onSave={save}
        />
      )}
    </div>
  );
}

function ProductModal({ value, isEdit, onClose, onSave }) {
  const [form, setForm] = useState(value);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-[440px] rounded-2xl border border-[#E5E7EB] bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="text-lg font-bold text-slate-900">{isEdit ? "Edit product" : "Add product"}</h3><button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-[12px] font-semibold text-slate-500 sm:col-span-2">Product name<input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Product name" /></label>
          <label className="block text-[12px] font-semibold text-slate-500">SKU<input className={inputCls} value={form.sku} onChange={(e) => set("sku", e.target.value)} placeholder="SKU-001" /></label>
          <label className="block text-[12px] font-semibold text-slate-500">Unit<input className={inputCls} value={form.unit} onChange={(e) => set("unit", e.target.value)} placeholder="units" /></label>
          <label className="block text-[12px] font-semibold text-slate-500">Quantity<input type="number" className={inputCls} value={form.quantity} onChange={(e) => set("quantity", e.target.value)} placeholder="0" /></label>
          <label className="block text-[12px] font-semibold text-slate-500">Low-stock at<input type="number" className={inputCls} value={form.lowStock} onChange={(e) => set("lowStock", e.target.value)} placeholder={String(DEFAULT_LOW)} /></label>
          <label className="block text-[12px] font-semibold text-slate-500 sm:col-span-2">Price (₹)<input type="number" className={inputCls} value={form.price} onChange={(e) => set("price", e.target.value)} placeholder="0" /></label>
        </div>
        <div className="mt-4 flex justify-end gap-2"><button onClick={onClose} className={btnGhost}>Cancel</button><button onClick={() => onSave(form)} className={btnAccent}>Save product</button></div>
      </div>
    </div>
  );
}
