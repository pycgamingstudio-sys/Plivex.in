import { Activity, Users } from "lucide-react";

const ago = (ms) => {
  if (ms < 15000) return "just now";
  if (ms < 60000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
  return `${Math.floor(ms / 3600000)}h ago`;
};

const money = (v) => `₹${(Number(v) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

// Today's Sales Activity — always shown to the owner, even with zero teammates.
export default function SalesActivityCard({ todays = [], totals = { invoices: 0, quotations: 0, revenue: 0 }, feed = [], now, loading, error }) {
  return (
    <div className="rounded-2xl border border-[#E5E7EB] bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#6D28D9]/10 text-[#6D28D9]"><Activity className="h-4 w-4" /></span><h3 className="text-[14px] font-bold text-slate-900">Today's Sales Activity</h3></div>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Live stream</span>
      </div>
      {error ? (
        <p role="alert" className="mt-3 py-6 text-center text-[12px] text-destructive">Today's activity is unavailable right now ({error.status ? `HTTP ${error.status}` : "network error"}).</p>
      ) : loading ? (
        <p role="status" className="mt-3 py-6 text-center text-[12px] text-slate-400">Loading today's activity…</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-[#6D28D9]/5 px-3 py-2 text-center"><p className="text-[16px] font-bold text-[#6D28D9]">{totals.invoices}</p><p className="text-[10px] font-semibold text-slate-500">Invoices</p></div>
            <div className="rounded-xl bg-blue-50 px-3 py-2 text-center"><p className="text-[16px] font-bold text-blue-600">{totals.quotations}</p><p className="text-[10px] font-semibold text-slate-500">Quotations</p></div>
            <div className="rounded-xl bg-emerald-50 px-3 py-2 text-center"><p className="text-[16px] font-bold text-emerald-600">{money(totals.revenue)}</p><p className="text-[10px] font-semibold text-slate-500">Revenue</p></div>
          </div>
          {todays.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {todays.map((s) => (
                <span key={s.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600"><Users className="h-3 w-3" />{s.name}: {Number(s.today_invoices) || 0} inv · {Number(s.today_quotations) || 0} quo · {money(s.today_revenue)}</span>
              ))}
            </div>
          )}
          <div className="mt-3 space-y-1.5">
            {feed.length === 0 && <p className="py-4 text-center text-[12px] text-slate-400">No staff actions recorded today yet.</p>}
            {feed.map((a, i) => (
              <div key={i} className="flex items-center justify-between gap-3 rounded-lg border border-[#E5E7EB] px-3 py-2">
                <p className="min-w-0 truncate text-[11px] font-semibold text-slate-700">{a.who}: {a.label}</p>
                <span className="shrink-0 text-[10px] text-slate-400">{ago(now - new Date(a.at).getTime())}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}