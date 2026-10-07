import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2, Pencil, X, ArrowRight, UserPlus, Search, ChevronDown, ChevronRight, Users, Target, Wallet } from "lucide-react";
import ClientRiskBadge from "@/components/ClientRiskBadge";
import { KEYS, loadList, saveList, removeItem, genId } from "@/lib/stores";
import { inputCls, btnGhost } from "@/lib/ui";
import { money2, btnAccent, subPill, Empty } from "@/lib/dashboardData";
import { paginate, totalPages } from "@/lib/paging";
import { usePaywall } from "@/lib/paywall";
import SummaryCard from "@/components/dashboard/SummaryCard";

const STAGES = ["New Lead", "Negotiation", "Won", "Lost"];
const blankClient = { name: "", company: "", email: "", phone: "", gstin: "", address: "" };
const blankLead = { name: "", phone: "", requirement: "", value: "" };

export default function CrmTab({ intent, onConsumeIntent }) {
  const { requestAction } = usePaywall();
  const [sub, setSub] = useState("clients");
  const [clients, setClients] = useState(() => loadList(KEYS.clients));
  const [leads, setLeads] = useState(() => loadList(KEYS.leads));
  const [invoices] = useState(() => loadList(KEYS.history));
  const [clientModal, setClientModal] = useState(null);
  const [leadModal, setLeadModal] = useState(false);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (intent === "new-client") { setSub("clients"); setClientModal({ ...blankClient }); onConsumeIntent(); }
    if (intent === "new-lead") { setSub("leads"); setLeadModal(true); onConsumeIntent(); }
  }, [intent]);

  const persistClients = (n) => { setClients(n); saveList(KEYS.clients, n); };
  const persistLeads = (n) => { setLeads(n); saveList(KEYS.leads, n); };
  const saveClient = (entry) => { if (!entry.name.trim()) return; if (!requestAction()) return; const n = clientModal.id ? clients.map((c) => (c.id === clientModal.id ? { ...entry, id: clientModal.id } : c)) : [{ ...entry, id: genId("client") }, ...clients]; persistClients(n); setClientModal(null); };
  const saveLead = (entry) => { if (!entry.name.trim()) return; if (!requestAction()) return; persistLeads([{ ...entry, id: genId("lead"), stage: "New Lead", value: Number(entry.value) || 0 }, ...leads]); setLeadModal(false); };
  const moveLead = (id, stage) => persistLeads(leads.map((l) => (l.id === id ? { ...l, stage } : l)));
  const invoiceFor = (c) => { localStorage.setItem(KEYS.pendingClient, JSON.stringify({ name: c.name, company: c.company, email: c.email, phone: c.phone, gstin: c.gstin, address: c.address })); navigate("/invoice-builder"); };

  const filteredClients = useMemo(() => clients.filter((c) => {
    const hay = `${c.name} ${c.company} ${c.email} ${c.phone} ${c.gstin}`.toLowerCase();
    return !q || hay.includes(q.toLowerCase());
  }), [clients, q]);
  const rows = paginate(filteredClients, page);
  const pages = totalPages(filteredClients);

  const activeLeads = leads.filter((l) => l.stage === "New Lead" || l.stage === "Negotiation");
  const pipelineValue = activeLeads.reduce((s, l) => s + Number(l.value || 0), 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard label="Total Clients" value={String(clients.length)} gradient="bg-gradient-to-br from-[#6D28D9] to-[#7C3AED]" icon={Users} badge="directory" />
        <SummaryCard label="Active Leads" value={String(activeLeads.length)} gradient="bg-gradient-to-br from-[#2563EB] to-[#3B82F6]" icon={Target} badge="open" />
        <SummaryCard label="Pipeline Value" value={money2(pipelineValue)} gradient="bg-gradient-to-br from-[#059669] to-[#10B981]" icon={Wallet} badge="forecast" />
      </div>

      <div className="flex gap-1.5 rounded-xl border border-[#E5E7EB] bg-white p-1.5">
        <button onClick={() => { setSub("clients"); setPage(1); }} className={subPill(sub, "clients")}>Clients Directory</button>
        <button onClick={() => setSub("leads")} className={subPill(sub, "leads")}>Lead Management</button>
      </div>

      {sub === "clients" ? (
        <div className="rounded-2xl border border-[#E5E7EB] bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-[#E5E7EB] p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative max-w-xs flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search clients…" className={`${inputCls} pl-9`} />
            </div>
            <button onClick={() => setClientModal({ ...blankClient })} className={btnAccent}><Plus className="h-3.5 w-3.5" />Add client</button>
          </div>

          {filteredClients.length === 0 ? (
            <Empty label="No clients match your search. Add a client to invoice them in one click." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[12px]">
                <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="w-8 px-3 py-2.5" />
                    <th className="px-3 py-2.5">Name</th>
                    <th className="px-3 py-2.5">Company</th>
                    <th className="px-3 py-2.5">Contact</th>
                    <th className="px-3 py-2.5">GSTIN</th>
                    <th className="px-3 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E7EB]">
                  {rows.map((c) => {
                    const open = expanded === c.id;
                    const history = invoices.filter((it) => it.clientName === c.name);
                    return (
                      <>
                        <tr key={c.id} className="hover:bg-slate-50">
                          <td className="px-3 py-3">
                            <button onClick={() => setExpanded(open ? null : c.id)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100" aria-label="Expand">
                              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </button>
                          </td>
                          <td className="px-3 py-3">
                            <p className="font-bold text-slate-900">{c.name}</p>
                            <ClientRiskBadge clientName={c.name} />
                          </td>
                          <td className="px-3 py-3 text-slate-500">{c.company || "—"}</td>
                          <td className="px-3 py-3 text-slate-500">{c.email || "—"}{c.phone ? ` · ${c.phone}` : ""}</td>
                          <td className="px-3 py-3 font-mono-ui text-slate-500">{c.gstin || "—"}</td>
                          <td className="px-3 py-3">
                            <div className="flex items-center justify-end gap-1.5">
                              <button onClick={() => invoiceFor(c)} className="inline-flex items-center gap-1 rounded-lg bg-[#6D28D9] px-2.5 py-1.5 text-[10px] font-bold text-white hover:bg-[#7C3AED]"><ArrowRight className="h-3 w-3" />Invoice</button>
                              <button onClick={() => setClientModal({ ...c })} className="rounded-lg border border-[#E5E7EB] p-1.5 text-slate-500 hover:bg-slate-50" aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></button>
                              <button onClick={() => persistClients(removeItem(KEYS.clients, c.id))} className="rounded-lg border border-[#E5E7EB] p-1.5 text-red-500 hover:bg-red-50" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                            </div>
                          </td>
                        </tr>
                        {open && (
                          <tr className="bg-slate-50/60">
                            <td />
                            <td colSpan={5} className="px-3 py-4">
                              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Client history ({history.length} invoice{history.length !== 1 ? "s" : ""})</p>
                              {history.length === 0 ? (
                                <p className="rounded-lg bg-white px-3 py-2 text-[11px] text-slate-400">No invoices raised for this client yet.</p>
                              ) : (
                                <div className="grid gap-1.5 sm:grid-cols-2">
                                  {history.map((it) => (
                                    <div key={it.id} className="flex items-center justify-between rounded-lg bg-white px-3 py-1.5 text-[11px]">
                                      <span className="text-slate-700">{it.number} · {it.issueDate || "—"}</span>
                                      <span className="font-semibold text-slate-900">{money2(it.total, it.currency)}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {c.address && <p className="mt-3 rounded-lg bg-white px-3 py-2 text-[11px] text-slate-500"><span className="text-slate-400">Address: </span>{c.address}</p>}
                              <div className="mt-2"><ClientRiskBadge clientName={c.name} showAdvice /></div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-[#E5E7EB] px-4 py-3 text-[11px] text-slate-500">
            <span>{filteredClients.length} client{filteredClients.length !== 1 ? "s" : ""}</span>
            <div className="flex items-center gap-2">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-lg border border-[#E5E7EB] px-2.5 py-1.5 font-semibold text-slate-500 disabled:opacity-40 hover:bg-slate-50">Prev</button>
              <span className="font-mono-ui">Page {page}/{pages}</span>
              <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="rounded-lg border border-[#E5E7EB] px-2.5 py-1.5 font-semibold text-slate-500 disabled:opacity-40 hover:bg-slate-50">Next</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex justify-end"><button onClick={() => setLeadModal(true)} className={btnAccent}><UserPlus className="h-3.5 w-3.5" />Add new lead</button></div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {STAGES.map((stage) => {
              const items = leads.filter((l) => l.stage === stage);
              const stageValue = items.reduce((s, l) => s + Number(l.value || 0), 0);
              return (
                <div key={stage} className="rounded-2xl border border-[#E5E7EB] bg-white p-3 shadow-sm">
                  <div className="mb-3 flex items-center justify-between"><h4 className="text-[12px] font-bold text-slate-700">{stage}</h4><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">{items.length}</span></div>
                  {stageValue > 0 && <p className="mb-2 text-[11px] font-bold text-[#6D28D9]">{money2(stageValue)}</p>}
                  <div className="space-y-2">
                    {items.map((l) => (
                      <div key={l.id} className="rounded-xl border border-[#E5E7EB] p-3">
                        <p className="text-[12px] font-bold text-slate-900">{l.name}</p>
                        <p className="text-[10px] text-slate-400">{l.phone || "—"}</p>
                        <p className="mt-1 text-[11px] text-slate-500">{l.requirement || "—"}</p>
                        <p className="mt-1 text-[12px] font-bold text-[#6D28D9]">{money2(l.value)}</p>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {STAGES.filter((s) => s !== stage).map((s) => <button key={s} onClick={() => moveLead(l.id, s)} className="rounded-md bg-slate-100 px-2 py-1 text-[9px] font-semibold text-slate-600 hover:bg-slate-200">→ {s}</button>)}
                          <button onClick={() => persistLeads(removeItem(KEYS.leads, l.id))} className="rounded-md bg-red-50 px-2 py-1 text-[9px] font-semibold text-red-500 hover:bg-red-100">del</button>
                        </div>
                      </div>
                    ))}
                    {items.length === 0 && <p className="py-4 text-center text-[10px] text-slate-300">No leads</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {clientModal && <ClientModal value={clientModal} onClose={() => setClientModal(null)} onSave={saveClient} />}
      {leadModal && <LeadModal onClose={() => setLeadModal(false)} onSave={saveLead} />}
    </div>
  );
}

function ClientModal({ value, onClose, onSave }) {
  const [form, setForm] = useState(value);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-[440px] rounded-2xl border border-[#E5E7EB] bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="text-lg font-bold text-slate-900">{value.id ? "Edit client" : "Add client"}</h3><button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-[12px] font-semibold text-slate-500">Name<input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Client name" /></label>
          <label className="block text-[12px] font-semibold text-slate-500">Company<input className={inputCls} value={form.company} onChange={(e) => set("company", e.target.value)} placeholder="Company" /></label>
          <label className="block text-[12px] font-semibold text-slate-500">Email<input className={inputCls} value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="email@client.com" /></label>
          <label className="block text-[12px] font-semibold text-slate-500">Phone<input className={inputCls} value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+91" /></label>
          <label className="block text-[12px] font-semibold text-slate-500">GSTIN<input className={inputCls} value={form.gstin} onChange={(e) => set("gstin", e.target.value)} placeholder="22AAAAA0000A1Z5" /></label>
        </div>
        <label className="mt-3 block text-[12px] font-semibold text-slate-500">Address<textarea className={`${inputCls} min-h-[64px]`} value={form.address} onChange={(e) => set("address", e.target.value)} /></label>
        <div className="mt-4 flex justify-end gap-2"><button onClick={onClose} className={btnGhost}>Cancel</button><button onClick={() => onSave(form)} className={btnAccent}>Save client</button></div>
      </div>
    </div>
  );
}

function LeadModal({ onClose, onSave }) {
  const [form, setForm] = useState(blankLead);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-[440px] rounded-2xl border border-[#E5E7EB] bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="text-lg font-bold text-slate-900">Add new lead</h3><button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button></div>
        <div className="mt-4 grid gap-3">
          <label className="block text-[12px] font-semibold text-slate-500">Lead name<input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Lead name" /></label>
          <label className="block text-[12px] font-semibold text-slate-500">Phone<input className={inputCls} value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+91" /></label>
          <label className="block text-[12px] font-semibold text-slate-500">Requirement<input className={inputCls} value={form.requirement} onChange={(e) => set("requirement", e.target.value)} placeholder="What do they need?" /></label>
          <label className="block text-[12px] font-semibold text-slate-500">Estimated value (₹)<input type="number" className={inputCls} value={form.value} onChange={(e) => set("value", e.target.value)} placeholder="0" /></label>
        </div>
        <div className="mt-4 flex justify-end gap-2"><button onClick={onClose} className={btnGhost}>Cancel</button><button onClick={() => onSave(form)} className={btnAccent}>Save lead</button></div>
      </div>
    </div>
  );
}