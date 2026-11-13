import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";

const SEEN_KEY_PREFIX = "plivex:welcomeSeen:";

export default function WelcomePopup({ userId, planName = "Free", plan = "free", planLoading = true }) {

  const [openForUser, setOpenForUser] = useState(null);

  useEffect(() => {
    // Reset on account changes/logout and wait for the authoritative plan before showing.
    setOpenForUser(null);
    if (!userId || planLoading) return undefined;
    const seenKey = SEEN_KEY_PREFIX + userId;
    let seen = false;
    try {
      seen = localStorage.getItem(seenKey) === "1";
    } catch {
      // Fail closed when persistence is unavailable to avoid repeated popups.
      return undefined;
    }
    if (seen) return undefined;
    const timer = window.setTimeout(() => setOpenForUser(userId), 12000);
    return () => window.clearTimeout(timer);
  }, [userId, planLoading, planName, plan]);

  const dismiss = () => {
    setOpen(false);
    if (!userId) return;
    try { localStorage.setItem(SEEN_KEY_PREFIX + userId, "1"); } catch { /* best effort */ }
  };

  if (!userId || openForUser !== userId || planLoading) return null;

  const normalizedPlan = String(plan || "free").toLowerCase();
  const isPaid = ["basic", "pro", "enterprise"].includes(normalizedPlan);
  const displayPlan = planName || (normalizedPlan.charAt(0).toUpperCase() + normalizedPlan.slice(1));
  const title = isPaid ? "Welcome to Plivex " + displayPlan : "Start free invoicing 👋";
  const description = isPaid
    ? "Your " + displayPlan + " subscription is active. Your workspace is ready with the features included in your plan."
    : "Create your first invoice with Plivex. No card needed to get started.";

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/30 p-4 backdrop-blur-sm sm:items-center" onClick={dismiss}>
      <div className="w-full max-w-[420px] overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-2xl fade-up" onClick={(e) => e.stopPropagation()}>
        <div className="relative bg-gradient-to-br from-[#6D28D9] to-[#4c1d95] p-5 text-white">
          <button onClick={dismiss} className="absolute right-3 top-3 rounded-lg p-2 text-white/80 hover:bg-white/10" aria-label="Dismiss"><X className="h-4 w-4" /></button>
          <div className="flex items-center gap-2"><Sparkles className="h-4 w-4" /><span className="text-[10px] font-bold uppercase tracking-[0.18em]">Welcome to Plivex</span></div>
          <h3 className="mt-2 pr-8 text-[19px] font-bold leading-tight">{title}</h3>
          <p className="mt-1.5 text-[12px] leading-relaxed text-white/85">{description}</p>
        </div>
        <div className="p-5">
          <p className="text-[12px] leading-relaxed text-slate-500">
            {isPaid
              ? "Explore your workspace and start managing your business. You can review your plan anytime from your account."
              : "Your invoices and clients are saved to your account. You can upgrade whenever you need more features."}
          </p>
          <button onClick={dismiss} className="mt-4 w-full rounded-xl bg-[#6D28D9] py-2.5 text-[13px] font-bold text-white hover:bg-[#7C3AED]">Let's go 🚀</button>
        </div>
      </div>
    </div>
  );
}