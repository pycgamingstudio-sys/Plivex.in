import { CalendarDays, Sparkles, Zap } from "lucide-react";
import { usePaywall } from "@/lib/paywall";

const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};

const TONES = {
  active: "bg-emerald-100 text-emerald-700",
  trial: "bg-[#6D28D9]/10 text-[#6D28D9]",
  free: "bg-slate-100 text-slate-600",
};

// Always-visible plan status: which plan is active, when it started and when it
// expires / renews. Trial accounts show the 14-day trial window as real dates.
// Rendered on every viewport (no responsive hiding).
export default function PlanStatusCard() {
  const { isPremium, planName, planStartedAt, planExpiresAt, trialActive, trialStartAt, trialExpiresAt, openPaywall } = usePaywall();

  const statusLabel = isPremium ? "Active" : trialActive ? "Free trial" : "Free";
  const tone = isPremium ? TONES.active : trialActive ? TONES.trial : TONES.free;
  const startedAt = isPremium ? planStartedAt : trialStartAt;
  const endsAt = isPremium ? planExpiresAt : trialExpiresAt;

  return (
    <div className="rounded-2xl border border-[#E5E7EB] bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#6D28D9]/10 text-[#6D28D9]"><Sparkles className="h-4 w-4" /></span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Your plan</p>
            <p className="text-[15px] font-bold text-slate-900">{planName || "Free"}</p>
          </div>
          <span className={`ml-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${tone}`}>{statusLabel}</span>
        </div>
        <button onClick={openPaywall} className="inline-flex items-center gap-1.5 rounded-xl bg-[#6D28D9] px-3.5 py-2 text-[12px] font-bold text-white hover:bg-[#7C3AED]">
          {isPremium ? <Zap className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}{isPremium ? "Manage plan" : "Activate plan"}
        </button>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <div className="flex items-center gap-2 rounded-xl border border-[#E5E7EB] px-3 py-2">
          <CalendarDays className="h-3.5 w-3.5 shrink-0 text-[#6D28D9]" />
          <span className="text-[11px] font-semibold text-slate-400">{isPremium ? "Activated on" : "Trial activated on"}</span>
          <span className="ml-auto text-[12px] font-bold text-slate-700">{formatDate(startedAt)}</span>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-[#E5E7EB] px-3 py-2">
          <CalendarDays className="h-3.5 w-3.5 shrink-0 text-[#6D28D9]" />
          <span className="text-[11px] font-semibold text-slate-400">{isPremium ? "Renews on" : "Trial expires on"}</span>
          <span className="ml-auto text-[12px] font-bold text-slate-700">{formatDate(endsAt)}</span>
        </div>
      </div>
    </div>
  );
}