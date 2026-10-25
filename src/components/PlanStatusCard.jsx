import { CalendarDays, Sparkles, Zap } from "lucide-react";
import { usePaywall } from "@/lib/paywall";

const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};

const TONES = {
  active: "bg-emerald-100 text-emerald-700",
  free: "bg-slate-100 text-slate-600",
};

export default function PlanStatusCard() {
  const { isPremium, planName, planStartedAt, planExpiresAt, openPaywall, planLoading } = usePaywall();
  if (planLoading) return null;

  const statusLabel = isPremium ? "Active" : "Free plan";
  const tone = isPremium ? TONES.active : TONES.free;

  return (
    <div className="rounded-2xl border border-[#E5E7EB] bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#6D28D9]/10 text-[#6D28D9]"><Sparkles className="h-4 w-4" /></span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Your plan</p>
            <p className="text-[15px] font-bold text-slate-900">{isPremium ? planName : "Free"}</p>
          </div>
          <span className={`ml-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${tone}`}>{statusLabel}</span>
        </div>
        <button onClick={openPaywall} className="inline-flex items-center gap-1.5 rounded-xl bg-[#6D28D9] px-3.5 py-2 text-[12px] font-bold text-white hover:bg-[#7C3AED]">
          {isPremium ? <Zap className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}{isPremium ? "Manage plan" : "View plans"}
        </button>
      </div>
      {isPremium ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <div className="flex items-center gap-2 rounded-xl border border-[#E5E7EB] px-3 py-2">
            <CalendarDays className="h-3.5 w-3.5 shrink-0 text-[#6D28D9]" />
            <span className="text-[11px] font-semibold text-slate-400">Activated on</span>
            <span className="ml-auto text-[12px] font-bold text-slate-700">{formatDate(planStartedAt)}</span>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-[#E5E7EB] px-3 py-2">
            <CalendarDays className="h-3.5 w-3.5 shrink-0 text-[#6D28D9]" />
            <span className="text-[11px] font-semibold text-slate-400">Renews on</span>
            <span className="ml-auto text-[12px] font-bold text-slate-700">{formatDate(planExpiresAt)}</span>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-[12px] text-slate-500">Free plan · no paid subscription active.</p>
      )}
    </div>
  );
}
