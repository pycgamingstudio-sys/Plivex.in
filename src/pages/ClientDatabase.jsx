import { useState } from "react";
import { Users, Plus, Pencil, Trash2, X } from "lucide-react";
import PageShell from "@/components/PageShell";
import { KEYS, loadList, saveList, genId } from "@/lib/stores";
import { inputCls, btnPrimary, btnGhost } from "@/lib/ui";

const blank = { name: "", company: "", email: "", phone: "", gstin: "", address: "" };

export default function ClientDatabase() {
  const [clients, setClients] = useState(() => loadList(KEYS.clients));
  const [editing, setEditing] = useState(null);
  const persist = (next) => { setClients(next); saveList(KEYS.clients, next); };
  const save = (entry) => {
    if (!entry.name.trim()) return;
    const next = editing?.id ? clients.map((c) => (c.id === editing.id ? { ...entry, id: editing.id } : c)) : [{ ...entry, id: genId("client") }, ...clients];
    persist(next); setEditing(null);
  };
  const remove = (id) => persist(clients.filter((c) => c.id !== id));

  return (
    <PageShell icon={Users} title="Client database" subtitle="Reuse client details across invoices in a couple of taps." action={<button onClick={() => setEditing({ ...blank })} className={btnPrimary}><Plus className="h-3.5 w-3.5" />Add client</button>}>
      {clients.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-10 text-center text-[13px] text-muted-foreground">No clients saved yet. Add your first client to speed up invoicing.</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {clients.map((c) => (
            <div key={c.id} className="rounded-xl border bg-card p-4">
              <div className="flex items-start justify-between gap-2"><div><p className="text-[14px] font-bold">{c.name || "Unnamed"}</p>{c.company && <p className="text-[11px] text-muted-foreground">{c.company}</p>}</div><div className="flex gap-1"><button onClick={() => setEditing({ ...c })} className="rounded-md p-1.5 hover:bg-secondary" aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></button><button onClick={() => remove(c.id)} className="rounded-md p-1.5 text-destructive hover:bg-destructive/10" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button></div></div>
              <div className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
                {c.email && <p>{c.email}</p>}
                {c.phone && <p>{c.phone}</p>}
                {c.gstin && <p className="font-mono-ui">GSTIN {c.gstin}</p>}
                {c.address && <p className="whitespace-pre-line">{c.address}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && <ClientModal value={editing} onClose={() => setEditing(null)} onSave={save} />}
    </PageShell>
  );
}

function ClientModal({ value, onClose, onSave }) {
  const [form, setForm] = useState(value);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-[440px] rounded-2xl border bg-card p-5 text-card-foreground shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="text-lg font-bold">{value.id ? "Edit client" : "Add client"}</h3><button onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary"><X className="h-4 w-4" /></button></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-[12px] font-semibold text-muted-foreground">Name<input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Client name" /></label>
          <label className="block text-[12px] font-semibold text-muted-foreground">Company<input className={inputCls} value={form.company} onChange={(e) => set("company", e.target.value)} placeholder="Company (optional)" /></label>
          <label className="block text-[12px] font-semibold text-muted-foreground">Email<input className={inputCls} value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="accounts@client.com" /></label>
          <label className="block text-[12px] font-semibold text-muted-foreground">Phone<input className={inputCls} value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+91" /></label>
          <label className="block text-[12px] font-semibold text-muted-foreground">GSTIN<input className={inputCls} value={form.gstin} onChange={(e) => set("gstin", e.target.value)} placeholder="22AAAAA0000A1Z5" /></label>
        </div>
        <label className="mt-3 block text-[12px] font-semibold text-muted-foreground">Address<textarea className={`${inputCls} min-h-[64px]`} value={form.address} onChange={(e) => set("address", e.target.value)} /></label>
        <div className="mt-4 flex justify-end gap-2"><button onClick={onClose} className={btnGhost}>Cancel</button><button onClick={() => onSave(form)} className={btnPrimary}>Save client</button></div>
      </div>
    </div>
  );
}