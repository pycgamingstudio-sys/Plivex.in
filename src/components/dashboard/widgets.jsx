// Shared presentational widgets & data helpers for the role-specific dashboards.
export const isPaid = (it) => it?.status === "Paid";
export const isToday = (d) => !!d && new Date(d).toDateString() === new Date().toDateString();
export const isThisMonth = (d) => !!d && new Date(d).getMonth() === new Date().getMonth() && new Date(d).getFullYear() === new Date().getFullYear();
export const sum = (list, f) => list.reduce((s, x) => s + (Number(f(x)) || 0), 0);
export const gstOf = (it) => (Number(it?.cgst) || 0) + (Number(it?.sgst) || 0) + (Number(it?.igst) || 0);
export const actText = (a) => a?.description || a?.text || a?.action || a?.message || "Activity recorded";
export const actDate = (a) => a?.date || a?.time || a?.created_date;

export function Panel({ icon: Icon, title, action, children }) {
  return (
    <div className="rounded-2xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4 text-[#6D28D9]" />}
          <h3 className="text-[13px] font-bold text-slate-900">{title}</h3>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export function Bar({ pct }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-slate-100">
      <div className="h-full rounded-full bg-[#6D28D9] transition-all" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  );
}

export function Row({ left, right, sub }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px]">
      <div className="min-w-0">
        <p className="truncate font-semibold text-slate-700">{left}</p>
        {sub && <p className="truncate text-[10px] text-slate-400">{sub}</p>}
      </div>
      <span className="shrink-0 font-bold text-slate-900">{right}</span>
    </div>
  );
}

export function PanelLink({ label, onClick }) {
  return <button onClick={onClick} className="flex items-center gap-1 text-[11px] font-bold text-[#6D28D9] hover:underline">{label}<span aria-hidden="true">→</span></button>;
}