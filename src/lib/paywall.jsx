import { backend as db } from '@/api/backendClient';

import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { X, Check, Sparkles, Lock, Crown, Star, XCircle } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";

import { startPayuCheckout } from "@/lib/payu";
import CurrentPlanCard from "@/components/CurrentPlanCard";
import { toast } from "@/components/ui/use-toast";
import { PLANS as DISPLAY_PLANS } from "@/lib/plans";

const FEATURE_ALIASES = { gstr1: "gstr1_export", team_management: "team", lead_pipeline: "lead_pipeline", payment_reminders: "payment_reminders", whatsapp_share: "whatsapp_share", custom_logo: "custom_logo", multi_currency: "multi_currency", premium_designs: "premium_designs" };

const PaywallContext = createContext(null);

export function usePaywall() {
  const ctx = useContext(PaywallContext);
  if (!ctx) return { plan: "free", limits: {}, usage: {}, remaining: () => 0, canAccess: () => false, requireFeature: () => false, refreshAccessStatus: async () => {}, isPremium: false, subscription: "free", planName: "Free", planId: "", planStartedAt: "", planExpiresAt: "", planLoading: false, requestAction: () => true, showPaywall: false, blocked: false, openPaywall: () => {}, closePaywall: () => {} };
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
  const [accessStatus, setAccessStatus] = useState({ plan: "free", limits: {}, usage: {}, features: {} });
  const [blockReason, setBlockReason] = useState("");
  const { user } = useAuth();
  useEffect(() => {
    let active = true;
    if (!user?.id) { setSubscription("free"); setPlanName("Free"); setPlanId(""); setPlanStartedAt(""); setPlanExpiresAt(""); setAccessStatus({ plan: "free", limits: {}, usage: {}, features: {} }); setPlanLoading(false); return () => { active = false; }; }
    // Premium is read from the server asynchronously — screens wait for this before
    // deciding to lock, so a paid account never flashes the lock screen on load.
    setPlanLoading(true);
    (async () => {
      try {
        // Plan and usage details come from the server, never from browser storage.
        const res = await db.functions.invoke("getAccessStatus", {});
        const st = res?.data || {};
        if (!active) return;
        const tier = String(st.plan || st.tier || (st.isPremium ? "basic" : "free")).toLowerCase();
        const normalizedPlan = ["basic", "pro", "enterprise"].includes(tier) ? tier : "free";
        setAccessStatus({ ...st, plan: normalizedPlan, limits: st.limits || {}, usage: st.usage || {}, features: st.features || {} });
        setSubscription(normalizedPlan);
        setPlanName(normalizedPlan === "enterprise" ? "Enterprise" : normalizedPlan === "pro" ? "Pro" : normalizedPlan === "basic" ? "Basic" : "Free");
        setPlanId(st.planId || st.plan_id || "");
        setPlanStartedAt(st.startedAt || st.started_at || "");
        setPlanExpiresAt(st.expiresAt || st.expires_at || "");
      } catch { if (active) { setSubscription("free"); setPlanName("Free"); setAccessStatus({ plan: "free", limits: {}, usage: {}, features: {} }); } } finally { if (active) setPlanLoading(false); }
    })();
    return () => { active = false; };
  }, [user?.id]);
  const refreshAccessStatus = useCallback(async () => {
    try {
      const res = await db.functions.invoke("getAccessStatus", {});
      const st = res?.data || {};
      const tier = String(st.plan || st.tier || (st.isPremium ? "basic" : "free")).toLowerCase();
      const normalizedPlan = ["basic", "pro", "enterprise"].includes(tier) ? tier : "free";
      setAccessStatus({ ...st, plan: normalizedPlan, limits: st.limits || {}, usage: st.usage || {}, features: st.features || {} });
      setSubscription(normalizedPlan);
      setPlanName(normalizedPlan === "enterprise" ? "Enterprise" : normalizedPlan === "pro" ? "Pro" : normalizedPlan === "basic" ? "Basic" : "Free");
      setPlanId(st.planId || st.plan_id || "");
      setPlanStartedAt(st.startedAt || st.started_at || "");
      setPlanExpiresAt(st.expiresAt || st.expires_at || "");
    } catch { /* retain the last server-confirmed status if refresh fails */ }
  }, []);

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

  const plan = accessStatus.plan || subscription || "free";
  const isPremium = plan === "basic" || plan === "pro" || plan === "enterprise";
  const rawLimits = accessStatus.limits || {};
  const rawUsage = accessStatus.usage || {};
  const limits = { ...rawLimits, clients: rawLimits.clients ?? rawLimits.clients_total, stock: rawLimits.stock ?? rawLimits.stock_total, invoices_monthly: rawLimits.invoices_monthly ?? rawLimits.invoices };
  const usage = { ...rawUsage, clients: rawUsage.clients ?? rawUsage.clients_total, stock: rawUsage.stock ?? rawUsage.stock_total, invoices_monthly: rawUsage.invoices_monthly ?? rawUsage.invoices };
  const remaining = useCallback((resource) => {
    const limit = limits[resource];
    const used = Number(usage[resource] || 0);
    if (limit === undefined || limit === null || limit === -1) return Infinity;
    return Math.max(0, Number(limit) - used);
  }, [limits, usage]);
  const canAccess = useCallback((feature) => {
    if (feature === "download_pdf" || feature === "save") return true;
    const key = FEATURE_ALIASES[feature] || feature;
    if (Object.prototype.hasOwnProperty.call(accessStatus.features || {}, key)) return !!accessStatus.features[key];
    if (key === "team" && Object.prototype.hasOwnProperty.call(accessStatus.features || {}, "team_management")) return !!accessStatus.features.team_management;
    return plan === "pro" || plan === "enterprise";
  }, [accessStatus.features, plan]);
  const requireFeature = useCallback((feature, reason = "") => {
    if (canAccess(feature)) return true;
    setBlockReason(reason || feature);
    setBlocked(true);
    setShowPaywall(true);
    return false;
  }, [canAccess]);
  const requestAction = useCallback(() => true, []);

  // Called only after the server has verified the PayU response hash and activated
  // the Subscription record. Never trusts a client-supplied plan.
  const applySubscription = useCallback((data) => {
    setSubscription(data?.tier || "pro");
    setPlanName(data?.planName || "Pro");
    setAccessStatus((prev) => ({ ...prev, plan: data?.tier || "pro" }));
    setBlocked(false); setShowPaywall(false);
  }, []);

  const openPaywall = useCallback((reason = "") => { setBlockReason(reason); setBlocked(Boolean(reason)); setShowPaywall(true); }, []);
  const closePaywall = useCallback(() => { if (!blocked) setShowPaywall(false); }, [blocked]);

  return (
    <PaywallContext.Provider value={{ plan, limits, usage, remaining, requireFeature, refreshAccessStatus, isPremium, subscription, planName, planId, planStartedAt, planExpiresAt, planLoading, requestAction, canAccess, applySubscription, upgrade: applySubscription, showPaywall, blocked, openPaywall, closePaywall }}>
      {children}
      {showPaywall && <PaywallModal blocked={blocked} blockReason={blockReason} currentPlan={{ active: isPremium, planId, planName, startedAt: planStartedAt, expiresAt: planExpiresAt, plan }} onClose={closePaywall} />}
    </PaywallContext.Provider>
  );
}

const PLANS = [
  {
    id: "basic_monthly", name: "Basic Monthly", price: 199, period: "month", amount: 19900, badge: null, accent: false,
    included: [
      "Up to 100 invoices per month",
      "Dynamic UPI QR Code Generation",
      "PDF downloads",
      "Basic Client Database",
      "Expense Tracker",
      "Standard Customer Support",
    ],
    locked: ["WhatsApp sharing", "Team and lead pipeline", "Payment reminders", "GSTR-1 export", "Custom logo", "Multi-currency", "Premium designs"],
  },
  {
    id: "pro_monthly", name: "Pro Monthly", price: 249, period: "month", amount: 24900, badge: "MOST POPULAR", accent: true,
    included: [
      "Up to 3,000 invoices per month",
      "Dynamic UPI QR Code & Online Payments",
      "WhatsApp One-Click Direct Share",
      "Ultra HD PDF Downloads with Custom Logo",
      "Full Client CRM & Lead Pipeline Management",
      "Advanced Expense & Profit/Loss Analytics",
      "GSTR-1 Ready Excel/CSV Exports",
      "Multi-Currency & Tax Breakdown (CGST/SGST/IGST)",
      "Auto Payment Reminders",
      
    ],
    locked: [],
  },
  {
    id: "basic_yearly", name: "Basic Yearly", price: 999, period: "year", amount: 99900, badge: "SAVE 58%", accent: false,
    included: [
      "Basic plan features for one year",
      "Up to 100 invoices per month",
      "Dynamic UPI QR Codes",
      "PDF downloads",
      "Expense Management",
      "Annual Savings (Cost-effective for individuals)",
      "Standard Support",
    ],
    locked: [],
  },
  {
    id: "enterprise_yearly", name: "Enterprise Yearly", price: 1599, period: "year", amount: 159900, badge: "BEST VALUE", accent: true,
    included: [
      "Pro plan features for one year",
      "Custom Invoice Templates & Advanced Branding",
      
      "Multi-User / Team Access",
      "Cloud-synced business records",
      
    ],
    locked: [],
  },
];

function PaywallModal({ blocked, blockReason = "", currentPlan, onClose }) {
  const { user } = useAuth();
  const [processing, setProcessing] = useState(null);
  const [notice, setNotice] = useState("");
  const [billing, setBilling] = useState("monthly");
  const activePlan = currentPlan?.planId ? PLANS.find((plan) => plan.id === currentPlan.planId) : null;
  const visiblePlans = [
    { id: "free", name: "Free", price: 0, period: billing === "monthly" ? "month" : "year", included: DISPLAY_PLANS.free.bullets, locked: [], accent: false, badge: null, checkoutPlan: null },
    { id: "basic", name: "Basic", price: billing === "monthly" ? DISPLAY_PLANS.basic.monthly : DISPLAY_PLANS.basic.yearly, period: billing === "monthly" ? "month" : "year", included: DISPLAY_PLANS.basic.bullets, locked: [], accent: false, badge: null, checkoutPlan: PLANS.find((p) => p.id === (billing === "monthly" ? "basic_monthly" : "basic_yearly")) },
    { id: "pro", name: "Pro", price: billing === "monthly" ? DISPLAY_PLANS.pro.monthly : DISPLAY_PLANS.pro.yearly, period: billing === "monthly" ? "month" : "year", included: DISPLAY_PLANS.pro.bullets, locked: [], accent: true, badge: "MOST POPULAR", checkoutPlan: PLANS.find((p) => p.id === (billing === "monthly" ? "pro_monthly" : "enterprise_yearly")) },
  ];

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
          <h3 className="mt-3 text-[22px] font-bold leading-tight">{blocked ? "Upgrade required" : "Choose your plan"}</h3>
          <p className="mt-1.5 text-[12px] leading-relaxed text-white/85">{blocked ? "This action is not available on your " + (currentPlan?.planName || "Free") + " plan. " + blockReason : "Choose the plan that fits your business. Free plan, no card needed."}</p>
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold">Free plan available · No card needed</div>
        </div>

        <div className="max-h-[64vh] overflow-y-auto px-4 py-5 sm:px-6">
          {currentPlan?.active && (
            <CurrentPlanCard planName={currentPlan.planName} benefits={activePlan?.included || []} startedAt={currentPlan.startedAt} expiresAt={currentPlan.expiresAt} />
          )}
          <div className="mb-4 flex items-center justify-center gap-2 rounded-xl bg-slate-100 p-1">
            <button onClick={() => setBilling("monthly")} className={`rounded-lg px-4 py-2 text-xs font-bold ${billing === "monthly" ? "bg-white text-[#6D28D9] shadow-sm" : "text-slate-500"}`}>Monthly</button>
            <button onClick={() => setBilling("yearly")} className={`rounded-lg px-4 py-2 text-xs font-bold ${billing === "yearly" ? "bg-white text-[#6D28D9] shadow-sm" : "text-slate-500"}`}>Yearly</button>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {visiblePlans.map((plan) => (
              <div key={plan.id} className={`relative flex flex-col rounded-2xl border p-4 ${plan.accent ? "border-[#6D28D9] bg-[#6D28D9]/5" : "border-[#E5E7EB] bg-white"}`}>
                {plan.badge && <span className="absolute -top-2.5 right-3 rounded-full bg-[#6D28D9] px-2.5 py-0.5 text-[9px] font-bold text-white">{plan.badge}</span>}
                <div className="flex items-center gap-2"><p className="text-[13px] font-bold text-slate-900">{plan.name}</p></div>
                <p className="mt-2 text-[26px] font-bold leading-none text-slate-900">₹{plan.price}<span className="text-[12px] font-medium text-slate-400">/{plan.period}</span></p>
                <div className="mt-3 flex-1 space-y-1.5">{plan.included.map((item) => <div key={item} className="flex items-start gap-2 text-[11px] font-medium text-slate-700"><span className="mt-0.5 text-emerald-600">✓</span>{item}</div>)}</div>
                {plan.checkoutPlan ? <button onClick={() => checkout(plan.checkoutPlan)} disabled={processing === plan.checkoutPlan.id} className={`mt-4 w-full rounded-xl py-2.5 text-[12px] font-bold disabled:opacity-60 ${plan.accent ? "bg-[#6D28D9] text-white" : "border border-[#6D28D9] text-[#6D28D9]"}`}>{processing === plan.checkoutPlan.id ? "Opening checkout…" : `Choose ${plan.name} · ₹${plan.price}/${plan.period}`}</button> : <button onClick={onClose} className="mt-4 w-full rounded-xl border border-slate-200 py-2.5 text-[12px] font-bold text-slate-600">{currentPlan?.plan === "free" ? "Current plan" : "Use Free plan"}</button>}
              </div>
            ))}
          </div>
          {notice && <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-center text-[11px] font-semibold text-amber-700">{notice}</p>}
        </div>

        <div className="border-t border-[#E5E7EB] px-6 py-4">
          {blocked ? (
            <button onClick={onClose} className="w-full text-center text-[12px] font-medium text-slate-400 hover:text-slate-600">Close</button>
          ) : (
            <button onClick={onClose} className="w-full text-center text-[12px] font-medium text-slate-400 hover:text-slate-600">Maybe later</button>
          )}
        </div>
      </div>
    </div>
  );
}