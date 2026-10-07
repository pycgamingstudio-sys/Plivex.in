import { Radio } from "lucide-react";

const ago = (ms) => {
  if (ms < 15000) return "just now";
  if (ms < 60000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
  return `${Math.floor(ms / 3600000)}h ago`;
};

const dot = (s) => (s === "online" ? "bg-emerald-500" : s === "idle" ? "bg-amber-400" : "bg-rose-400");
const dotLabel = (s) => (s === "online" ? "Online" : s === "idle" ? "Idle" : "Offline");

// Live staff presence — rendered only when the workspace has at least one teammate.
export default function StaffPresenceCard({ staff = [], loading, error }) {
  return (
    <div className="rounded-2xl border border-[#E5E7EB] bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#6D28D9]/10 text-[#6D28D9]"><Radio className="h-4 w-4" /></span><h3 className="text-[14px] font-bold text-slate-900">Live Staff Presence</h3></div>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Real-time</span>
      </div>
      {error ? (
        <p role="alert" className="mt-3 py-6 text-center text-[12px] text-destructive">Staff presence unavailable ({error.status ? `HTTP ${error.status}` : "network error"}): {error.message}</p>
      ) : loading ? (
        <p role="status" className="mt-3 py-6 text-center text-[12px] text-slate-400">Loading staff presence…</p>
      ) : (
        <div className="mt-3 space-y-2">
          {staff.length === 0 && <p className="py-6 text-center text-[12px] text-slate-400">No staff presence yet — activity appears as your team uses the workspace.</p>}
          {staff.map((s) => (
            <div key={s.id} className="flex items-start justify-between gap-3 rounded-xl border border-[#E5E7EB] px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot(s.status)}`} />
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-bold text-slate-900">{s.name}{s.role === "admin" && <span className="ml-1.5 rounded bg-[#6D28D9]/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#6D28D9]">Owner</span>}</p>
                  <p className="truncate text-[11px] text-slate-500">{s.current_page || "—"}</p>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[10px] font-bold text-slate-500">{dotLabel(s.status)}</p>
                <p className="text-[10px] text-slate-400">{Number.isFinite(s.elapsed) ? ago(s.elapsed) : "Not active yet"}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}