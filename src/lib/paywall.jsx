import { backend as db } from '@/api/backendClient';

import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { X, Check, Sparkles, Lock, Crown, Star, XCircle } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";

import { startPayuCheckout } from "@/lib/payu";
import CurrentPlanCard from "@/components/CurrentPlanCard";
import { toast } from "@/components/ui/use-toast";

const TRIAL_DAYS = 14;

const FEATURE_PLANS = {
  download_pdf: ["basic", "pro"],
  whatsapp_share: ["basic", "pro"],
  save: ["basic", "pro"],
  gstr1: ["pro"],
  custom_logo: ["pro"],
  multi_currency: ["pro"],
  team_management: ["pro"],
  premium_designs: ["pro"],
};

const PaywallContext = createContext(null);

export function usePaywall() {
  const ctx = useContext(PaywallContext);
  if (!ctx) return { isPremium: true, subscription: "pro", planName: "Pro", planId: "", planStartedAt: "", planExpiresAt: "", planLoading: false, trialActive: false, trialDaysLeft: 0, trialStartAt: "", trialExpiresAt: "", requestAction: () => true, canAccess: () => true, activatePlan: () => {}, upgrade: () => {}, showPaywall: false, blocked: false, openPaywall: () => {}, closePaywall: () => {} };
  return ctx;
}

export function PaywallProvider({ children }) {
  // Premium status is authoritative from the server-side Subscription entity —
  // never from localStorage, which a user could edit to unlock premium for free.
  const [subscription, setSubscription] = useState("free");
  const [planName, setPlanName] = useState("Free");
  const [planId, setPlanId] = useState("");
  const [planStartedAt, setPlanStartedAt] = useState("");
  const [planExpiresAt, setPlanExpiresAt] = useState("");
  const [planLoading, setPlanLoading] = useState(true);
  const [serverTrial, setServerTrial] = useState(null);
  const { user } = useAuth();
  useEffect(() => {
    let active = true;
    if (!user?.id) { setSubscription("free"); setPlanName("Free"); setPlanId(""); setPlanStartedAt(""); setPlanExpiresAt(""); setPlanLoading(false); return () => { active = false; }; }
    // Premium is read from the server asynchronously — screens wait for this before
    // deciding to lock, so a paid account never flashes the lock screen on load.
    setPlanLoading(true);
    (async () => {
      try {
        // Premium and trial status come from the server (get-access-status), never from the browser.
        const res = await db.functions.invoke("getAccessStatus", {});
        const st = res?.data || {};
        if (!active) return;
        setServerTrial({ active: !!st.trialActive, expiresAt: st.trialExpiresAt || "" });
        if (st.isPremium) {
          const tier = st.tier || "pro";
          setSubscription(tier);
          setPlanName(tier === "pro" ? "Pro" : "Basic");
          setPlanId("");
          setPlanStartedAt("");
          setPlanExpiresAt(st.expiresAt || "");
        } else {
          setSubscription("free"); setPlanName("Free");
          setPlanId(""); setPlanStartedAt(""); setPlanExpiresAt("");
        }
      } catch { if (active) { setSubscription("free"); setPlanName("Free"); setServerTrial(null); } } finally { if (active) setPlanLoading(false); }
    })();
    return () => { active = false; };
  }, [user?.id]);
  // PayU sends the customer back here after the backend has verified the payment.
  // The query flag only drives the confirmation message — premium itself is always
  // read from the Subscription record above, never from the URL or localStorage.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get("payment");
    if (!payment) return;
    if (payment === "success") toast({ title: "Payment successful", description: "Your premium plan is now active." });
    else if (payment === "failed") toast({ title: "Payment failed", description: "No charge was made. You can try again.", variant: "destructive" });
    else toast({ title: "Payment not verified", description: "We could not confirm this payment. Contact support if you were charged.", variant: "destructive" });
    params.delete("payment");
    params.delete("txnid");
    const query = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, []);
  const [showPaywall, setShowPaywall] = useState(false);
  const [blocked, setBlocked] = useState(false);

  const isPremium = subscription !== "free";
  // The 14-day trial is anchored to the account's registration date — never to the
  // first time the app was opened, a login, or a browser session. trial_start_at is
  // written at registration; created_date is the fallback for older accounts.
  // The server decides whether the 14-day trial is still running (get-access-status).
  const trialExpiresMs = serverTrial?.expiresAt ? new Date(serverTrial.expiresAt).getTime() : null;
  const trialDaysLeft = serverTrial?.active && trialExpiresMs
    ? Math.max(0, Math.ceil((trialExpiresMs - Date.now()) / 86400000))
    : 0;
  const trialStartAt = trialExpiresMs ? new Date(trialExpiresMs - TRIAL_DAYS * 86400000).toISOString() : "";
  const trialExpiresAt = trialExpiresMs ? new Date(trialExpiresMs).toISOString() : "";
  // A paid plan always supersedes the trial: the moment a subscription is active
  // the account is no longer a trial user, even if the 14 days have not elapsed.
  const trialActive = !isPremium && !!user && !!serverTrial?.active;

  // The 14-day trial unlocks exactly what the Basic plan includes — never the
  // Pro-only features (GSTR-1 export, custom logo, multi-currency, team access).
  const effectiveTier = isPremium ? subscription : trialActive ? "basic" : "free";
  const canAccess = useCallback((feature) => (FEATURE_PLANS[feature] || []).includes(effectiveTier), [effectiveTier]);

  // Called only after the server has verified the PayU response hash and activated
  // the Subscription record. Never trusts a client-supplied plan.
  const applySubscription = useCallback((data) => {
    setSubscription(data?.tier || "pro");
    setPlanName(data?.planName || "Pro");
    setBlocked(false); setShowPaywall(false);
  }, []);

  const requestAction = useCallback(() => {
    if (isPremium || trialActive) return true;
    setBlocked(true); setShowPaywall(true);
    return false;
  }, [isPremium, trialActive]);

  const openPaywall = useCallback(() => { setBlocked(false); setShowPaywall(true); }, []);
  const closePaywall = useCallback(() => { if (!blocked) setShowPaywall(false); }, [blocked]);

  return (
    <PaywallContext.Provider value={{ isPremium, subscription, planName, planId, planStartedAt, planExpiresAt, planLoading, trialActive, trialDaysLeft, trialStartAt, trialExpiresAt, requestAction, canAccess, applySubscription, upgrade: applySubscription, showPaywall, blocked, openPaywall, closePaywall }}>
      {children}
      {showPaywall && <PaywallModal blocked={blocked} trialActive={trialActive} trialDaysLeft={trialDaysLeft} currentPlan={{ active: isPremium, planId, planName, startedAt: planStartedAt, expiresAt: planExpiresAt }} onClose={closePaywall} />}
    </PaywallContext.Provider>
  );
}

const PLANS = [
  {
    id: "basic_monthly", name: "Basic Monthly", price: 199, period: "month", amount: 19900, badge: null, accent: false,
    included: [
      "Up to 50 Invoices & Quotations / month",
      "Dynamic UPI QR Code Generation",
      "Instant WhatsApp Sharing",
      "Standard HD PDF Downloads",
      "Basic Client Database",
      "Expense Tracker",
      "Standard Customer Support",
    ],
    locked: ["GSTR-1 Tax Reports", "Custom Business Logo", "Multi-Currency Support"],
  },
  {
    id: "pro_monthly", name: "Pro Monthly", price: 249, period: "month", amount: 24900, badge: "MOST POPULAR", accent: true,
    included: [
      "UNLIMITED Invoices, Quotations & Bills",
      "Dynamic UPI QR Code & Online Payments",
      "WhatsApp One-Click Direct Share",
      "Ultra HD PDF Downloads with Custom Logo",
      "Full Client CRM & Lead Pipeline Management",
      "Advanced Expense & Profit/Loss Analytics",
      "GSTR-1 Ready Excel/CSV Exports",
      "Multi-Currency & Tax Breakdown (CGST/SGST/IGST)",
      "Auto Payment Reminders",
      "Priority 24/7 Support",
    ],
    locked: [],
  },
  {
    id: "basic_yearly", name: "Basic Yearly", price: 999, period: "year", amount: 99900, badge: "SAVE 58%", accent: false,
    included: [
      "Includes ALL ₹199 Basic Plan features for 1 FULL YEAR (12 Months Access)",
      "Up to 600 Invoices & Quotations / year",
      "Dynamic UPI QR Codes",
      "Instant WhatsApp Share & HD PDFs",
      "Expense Management",
      "Annual Savings (Cost-effective for individuals)",
      "Standard Support",
    ],
    locked: [],
  },
  {
    id: "enterprise_yearly", name: "Enterprise Yearly", price: 1599, period: "year", amount: 159900, badge: "BEST VALUE", accent: true,
    included: [
      "Includes ALL ₹249 Pro Plan features for 1 FULL YEAR",
      "Custom Invoice Templates & Advanced Branding",
      "Dedicated Account Manager",
      "Multi-User / Team Access",
      "Auto Cloud Backup & Lifetime History",
      "Priority WhatsApp & Call Support",
    ],
    locked: [],
  },
];

function PaywallModal({ blocked, trialActive, trialDaysLeft, currentPlan, onClose }) {
  const { user } = useAuth();
  const [processing, setProcessing] = useState(null);
  const [notice, setNotice] = useState("");
  const activePlan = currentPlan?.planId ? PLANS.find((plan) => plan.id === currentPlan.planId) : null;

  const checkout = async (plan) => {
    setProcessing(plan.id);
    setNotice("");
    // PayU opens its hosted page with a real browser redirect, so the flow finishes
    // on return — premium is then read from the verified backend record.
    await startPayuCheckout({ planId: plan.id, phone: user?.phone, onError: (m) => setNotice(m) });
    setProcessing(null);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-[#1f1c35]/60 p-4 backdrop-blur-md sm:items-center">
      <div className="my-4 w-full max-w-3xl overflow-hidden rounded-3xl border border-white/10 bg-white shadow-2xl">
        <div className="relative bg-gradient-to-br from-[#6D28D9] to-[#4c1d95] p-6 text-white">
          {!blocked && <button onClick={onClose} className="absolute right-3 top-3 rounded-lg p-2 text-white/80 hover:bg-white/10" aria-label="Close"><X className="h-4 w-4" /></button>}
          <div className="flex items-center gap-2"><Sparkles className="h-4 w-4" /><span className="text-[10px] font-bold uppercase tracking-[0.18em]">Plivex Premium</span></div>
          <h3 className="mt-3 text-[22px] font-bold leading-tight">{blocked ? "Your 14-day trial has completed!" : "Choose your plan"}</h3>
          <p className="mt-1.5 text-[12px] leading-relaxed text-white/85">{blocked ? "Upgrade to a paid plan to unlock unlimited invoices, data backup and team access." : "Unlock unlimited actions and premium features across the entire workspace."}</p>
          {trialActive ? (
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold">Trial active · Basic plan features · {trialDaysLeft} day{trialDaysLeft !== 1 ? "s" : ""} left</div>
          ) : (
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold">Free trial ended · choose a plan to continue</div>
          )}
        </div>

        <div className="max-h-[64vh] overflow-y-auto px-4 py-5 sm:px-6">
          {currentPlan?.active && (
            <CurrentPlanCard planName={currentPlan.planName} benefits={activePlan?.included || []} startedAt={currentPlan.startedAt} expiresAt={currentPlan.expiresAt} />
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {PLANS.map((plan) => (
              <div key={plan.id} className={`relative flex flex-col rounded-2xl border p-4 ${plan.accent ? "border-[#6D28D9] bg-[#6D28D9]/5" : "border-[#E5E7EB] bg-white"}`}>
                {plan.badge && <span className={`absolute -top-2.5 right-4 rounded-full px-2.5 py-0.5 font-mono-ui text-[9px] font-bold uppercase tracking-wider text-white ${plan.accent ? "bg-[#6D28D9]" : "bg-slate-500"}`}>{plan.badge}</span>}
                <div className="flex items-center gap-2">
                  {plan.accent ? <Crown className="h-4 w-4 text-[#6D28D9]" /> : <Star className="h-4 w-4 text-slate-400" />}
                  <p className="text-[13px] font-bold text-slate-900">{plan.name}</p>
                </div>
                <p className="mt-2 text-[26px] font-bold leading-none text-slate-900">₹{plan.price}<span className="text-[12px] font-medium text-slate-400">/{plan.period}</span></p>
                <div className="mt-3 space-y-1.5">
                  {plan.included.map((f) => (
                    <div key={f} className="flex items-start gap-2 text-[11px] font-medium text-slate-700"><span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Check className="h-2.5 w-2.5" /></span>{f}</div>
                  ))}
                  {plan.locked.map((f) => (
                    <div key={f} className="flex items-start gap-2 text-[11px] font-medium text-slate-400"><span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600"><XCircle className="h-2.5 w-2.5" /></span>{f} (Locked)</div>
                  ))}
                </div>
                <button onClick={() => checkout(plan)} disabled={processing === plan.id} className={`mt-4 w-full rounded-xl py-2.5 text-[12px] font-bold transition-transform hover:-translate-y-0.5 disabled:opacity-60 ${plan.accent ? "bg-[#6D28D9] text-white" : "border border-[#6D28D9] text-[#6D28D9] hover:bg-[#6D28D9]/5"}`}>
                  {processing === plan.id ? "Opening checkout…" : `Buy — ₹${plan.price}/${plan.period}`}
                </button>
              </div>
            ))}
          </div>
          {notice && <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-center text-[11px] font-semibold text-amber-700">{notice}</p>}
        </div>

        <div className="border-t border-[#E5E7EB] px-6 py-4">
          {blocked ? (
            <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-slate-500"><Lock className="h-3 w-3" />This window stays open until you upgrade.</p>
          ) : (
            <button onClick={onClose} className="w-full text-center text-[12px] font-medium text-slate-400 hover:text-slate-600">Maybe later</button>
          )}
        </div>
      </div>
    </div>
  );
}