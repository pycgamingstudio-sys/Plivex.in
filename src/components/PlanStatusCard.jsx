import { useEffect, useState } from "react";
import { CalendarDays, Sparkles, Zap, Ban } from "lucide-react";
import { backend as db } from "@/api/backendClient";
import { useAuth } from "@/lib/AuthContext";
import { usePaywall } from "@/lib/paywall";

const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};
const TONES = { active: "bg-emerald-100 text-emerald-700", free: "bg-slate-100 text-slate-600" };

export default function PlanStatusCard() {
  const { isPremium, planName, planStartedAt, planExpiresAt, planResetsAt, limits, usage, openPaywall, planLoading } = usePaywall();
  const { user } = useAuth();
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelMessage, setCancelMessage] = useState("");
  const [cancelScheduled, setCancelScheduled] = useState(false);
  const [cancelAvailable, setCancelAvailable] = useState(false);
  useEffect(() => {
    let active = true;
    if (user?.role === "admin" && isPremium) {
      setCancelAvailable(false);
      db.functions.invoke("manageCashfreeSubscription", { action: "status" })
        .then((result) => {
          if (!active) return;
          const available = !result?.error && result?.data?.available === true;
          setCancelAvailable(available);
          setCancelScheduled(available && Boolean(result?.data?.cancelAtPeriodEnd));
        })
        .catch(() => {
          if (active) { setCancelAvailable(false); setCancelScheduled(false); }
        });
    } else {
      setCancelAvailable(false);
      setCancelScheduled(false);
    }
    return () => { active = false; };
  }, [user?.role, isPremium, planExpiresAt]);
  const scheduleCancellation = async () => {
    const action = cancelScheduled ? "resume" : "cancel";
    if (action === "cancel" && !window.confirm("Schedule cancellation at the end of the current paid period? Your access will remain active until expiry.")) return;
    setCancelLoading(true);
    setCancelMessage("");
    try {
      const result = await db.functions.invoke("manageCashfreeSubscription", { action });
      if (result?.error) throw result.error;
      if (result?.data?.available !== true || result?.data?.ok !== true) {
        setCancelAvailable(false);
        setCancelScheduled(false);
        setCancelMessage("Cancellation is available only for an active Cashfree subscription.");
        return;
      }
      setCancelAvailable(true);
      setCancelScheduled(action === "cancel");
      setCancelMessage(result.data.message || (action === "cancel" ? "Cancellation scheduled at expiry." : "Cancellation withdrawn."));
    } catch (error) {
      setCancelMessage(error?.message || "Could not schedule cancellation. Please try again.");
    } finally { setCancelLoading(false); }
  };
  if (planLoading) return null;
  const freeStarted = planStartedAt || user?.created_at || user?.createdAt || user?.created_date || "";
  const startedAt = isPremium ? planStartedAt : freeStarted;
  const endsAt = isPremium ? planExpiresAt : planResetsAt;
  const label = isPremium ? "Active" : "Free plan";
  const tone = isPremium ? TONES.active : TONES.free;

  const overLimitItems = [
    { label: "invoices", used: Number(usage.invoices_monthly ?? usage.invoices ?? 0), limit: Number(limits.invoices_monthly ?? limits.invoices ?? 30) },
    { label: "quotations", used: Number(usage.quotations_monthly ?? usage.quotations ?? 0), limit: Number(limits.quotations_monthly ?? limits.quotations ?? 10) },
    { label: "expenses", used: Number(usage.expenses_monthly ?? usage.expenses ?? 0), limit: Number(limits.expenses_monthly ?? limits.expenses ?? 30) },
    { label: "stock items", used: Number(usage.stock ?? usage.stock_total ?? 0), limit: Number(limits.stock ?? limits.stock_total ?? 20) },
    { label: "clients", used: Number(usage.clients ?? usage.clients_total ?? 0), limit: Number(limits.clients ?? limits.clients_total ?? 20) },
  ].filter((item) => item.used > item.limit);


  return (
    <div className="rounded-2xl border border-[#E5E7EB] bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#6D28D9]/10 text-[#6D28D9]"><Sparkles className="h-4 w-4" /></span>
          <div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Your plan</p><p className="text-[15px] font-bold text-slate-900">{isPremium ? (planName || "Basic") : "Free"}</p></div>
          <span className={`ml-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${tone}`}>{label}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2"><button onClick={openPaywall} className="inline-flex items-center gap-1.5 rounded-xl bg-[#6D28D9] px-3.5 py-2 text-[12px] font-bold text-white hover:bg-[#7C3AED]">{isPremium ? <Zap className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}{isPremium ? "Manage plan" : "View plans"}</button>{isPremium && user?.role === "admin" && cancelAvailable && <button onClick={scheduleCancellation} disabled={cancelLoading} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-[12px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"><Ban className="h-3.5 w-3.5" />{cancelLoading ? "Saving…" : cancelScheduled ? "Undo cancellation" : "Cancel at expiry"}</button>}</div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <div className="flex items-center gap-2 rounded-xl border border-[#E5E7EB] px-3 py-2"><CalendarDays className="h-3.5 w-3.5 shrink-0 text-[#6D28D9]" /><span className="text-[11px] font-semibold text-slate-400">{isPremium ? "Activated on" : "Free plan started"}</span><span className="ml-auto text-[12px] font-bold text-slate-700">{formatDate(startedAt)}</span></div>
        <div className="flex items-center gap-2 rounded-xl border border-[#E5E7EB] px-3 py-2"><CalendarDays className="h-3.5 w-3.5 shrink-0 text-[#6D28D9]" /><span className="text-[11px] font-semibold text-slate-400">{isPremium ? "Renews on" : "Free credits renew"}</span><span className="ml-auto text-[12px] font-bold text-slate-700">{formatDate(endsAt)}</span></div>
      </div>
      {cancelMessage && <p role="status" className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{cancelMessage}</p>}
      {!isPremium && overLimitItems.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-bold text-amber-900">Your workspace is over the Free plan limits</p>
          <p className="mt-1 text-xs leading-5 text-amber-800">You have more saved {overLimitItems.map((item) => item.label).join(", ")} than Free allows. Existing records remain saved, but you may need to remove items above the Free limits before adding more. Upgrade to Basic or Pro to use the higher limits.</p>
          <button onClick={openPaywall} className="mt-2 rounded-lg bg-[#6D28D9] px-3 py-2 text-xs font-bold text-white">View plans</button>
        </div>
      )}
    </div>
  );
}