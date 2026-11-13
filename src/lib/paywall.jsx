import { backend as db, supabase } from '@/api/backendClient';
import { useAuth } from '@/lib/AuthContext';
import { startCashfreeCheckout } from "@/lib/cashfree";

import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { X, Check, Sparkles, Lock, Crown, Star, XCircle } from "lucide-react";

import CurrentPlanCard from "@/components/CurrentPlanCard";
import { toast } from "@/components/ui/use-toast";
import { PLANS as DISPLAY_PLANS } from "@/lib/plans";
import { GLOBAL_BILLING, formatPlanPrice } from "@/global/billing/pricing.js";
import { getCountryByCode } from "@/global/countries/country-registry.js";

// Read subscription limits directly from the authoritative Supabase RPC.
// The old Lovable getAccessStatus endpoint can return stale Free-plan limits
// even after a payment provider has activated a subscription in Supabase.
async function loadAccessStatus() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const userId = sessionData?.session?.user?.id;
  if (!userId) throw new Error("Not signed in");
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("workspace_id, created_at")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile?.workspace_id) throw new Error("Workspace not found");
  const { data, error } = await supabase.rpc("get_access_status", { p_workspace_id: profile.workspace_id });
  if (error) throw error;
  const status = data || {};
  // The profile creation timestamp is the authoritative fallback for the first plan date.
  return { ...status, startedAt: status.startedAt || status.started_at || profile.created_at || "" };
}

const FEATURE_ALIASES = { gstr1: "gstr1_export", team_management: "team", lead_pipeline: "lead_pipeline", payment_reminders: "payment_reminders", whatsapp_share: "whatsapp_share", custom_logo: "custom_logo", multi_currency: "multi_currency", premium_designs: "premium_designs" };

const PaywallContext = createContext(null);

export function usePaywall() {
  const ctx = useContext(PaywallContext);
  if (!ctx) return { plan: "free", limits: {}, usage: {}, remaining: (resource) => 0, canAccess: (feature) => false, requireFeature: (feature, reason) => false, refreshAccessStatus: async () => {}, isPremium: false, subscription: "free", planName: "Free", planId: "", planStartedAt: "", planExpiresAt: "", planLoading: false, requestAction: () => true, showPaywall: false, blocked: false, openPaywall: (reason) => {}, closePaywall: () => {} };
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
  const [planResetsAt, setPlanResetsAt] = useState("");
  const [planLoading, setPlanLoading] = useState(true);
  const [accessStatus, setAccessStatus] = useState({ plan: "free", limits: {}, usage: {}, features: {} });
  const [blockReason, setBlockReason] = useState("");
  const { user } = useAuth();
  useEffect(() => {
    let active = true;
    if (!user?.id) { setSubscription("free"); setPlanName("Free"); setPlanId(""); setPlanStartedAt(""); setPlanExpiresAt(""); setPlanResetsAt(""); setAccessStatus({ plan: "free", limits: {}, usage: {}, features: {} }); setPlanLoading(false); return () => { active = false; }; }
    // Premium is read from the server asynchronously — screens wait for this before
    // deciding to lock, so a paid account never flashes the lock screen on load.
    setPlanLoading(true);
    (async () => {
      try {
        // Plan and usage details come from the server, never from browser storage.
        const st = await loadAccessStatus();
        if (!active) return;
        const tier = String(st.plan || st.tier || (st.isPremium ? "basic" : "free")).toLowerCase();
        const normalizedPlan = ["basic", "pro", "enterprise"].includes(tier) ? tier : "free";
        setAccessStatus({ ...st, plan: normalizedPlan, limits: st.limits || {}, usage: st.usage || {}, features: st.features || {} });
        setSubscription(normalizedPlan);
        setPlanName(normalizedPlan === "enterprise" ? "Enterprise" : normalizedPlan === "pro" ? "Pro" : normalizedPlan === "basic" ? "Basic" : "Free");
        setPlanId(st.planId || st.plan_id || "");
        setPlanStartedAt(st.startedAt || st.started_at || "");
        setPlanExpiresAt(st.expiresAt || st.expires_at || "");
      setPlanResetsAt(st.resetsAt || st.resets_at || "");
      } catch { if (active) { setSubscription("free"); setPlanName("Free"); setAccessStatus({ plan: "free", limits: {}, usage: {}, features: {} }); } } finally { if (active) setPlanLoading(false); }
    })();
    return () => { active = false; };
  }, [user?.id]);
  const refreshAccessStatus = useCallback(async () => {
    try {
      const st = await loadAccessStatus();
      const tier = String(st.plan || st.tier || (st.isPremium ? "basic" : "free")).toLowerCase();
      const normalizedPlan = ["basic", "pro", "enterprise"].includes(tier) ? tier : "free";
      setAccessStatus({ ...st, plan: normalizedPlan, limits: st.limits || {}, usage: st.usage || {}, features: st.features || {} });
      setSubscription(normalizedPlan);
      setPlanName(normalizedPlan === "enterprise" ? "Enterprise" : normalizedPlan === "pro" ? "Pro" : normalizedPlan === "basic" ? "Basic" : "Free");
      setPlanId(st.planId || st.plan_id || "");
      setPlanStartedAt(st.startedAt || st.started_at || "");
      setPlanExpiresAt(st.expiresAt || st.expires_at || "");
      setPlanResetsAt(st.resetsAt || st.resets_at || "");
      return true;
    } catch {
      // Keep the last server-confirmed state and let callers show a retry message.
      return false;
    }
  }, []);

  // Cashfree returns the customer here after the backend verifies the payment.
  // The query flag only drives the confirmation message — premium itself is always
  // read from the Subscription record above, never from the URL or localStorage.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get("payment");
    if (!payment) return;
    let active = true;
    const finishPaymentReturn = async () => {
      if (payment === "success") {
        const refreshed = await refreshAccessStatus();
        if (!active) return;
        if (refreshed) {
          toast({ title: "Payment successful", description: "Your Cashfree payment is verified and your plan has been refreshed." });
        } else {
          toast({ title: "Payment received", description: "Your plan status could not refresh yet. Reload the app or contact support if access does not update.", variant: "destructive" });
        }
      } else if (payment === "failed") {
        toast({ title: "Payment failed", description: "No charge was confirmed. You can try again.", variant: "destructive" });
      } else {
        toast({ title: "Payment not verified", description: "We could not confirm this payment. Contact support if you were charged.", variant: "destructive" });
      }
      params.delete("payment");
      params.delete("txnid");
      const query = params.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    };
    void finishPaymentReturn();
    return () => { active = false; };
  }, [refreshAccessStatus]);
  const [showPaywall, setShowPaywall] = useState(false);
  const [blocked, setBlocked] = useState(false);

  const plan = accessStatus.plan || subscription || "free";
  const isPremium = plan === "basic" || plan === "pro" || plan === "enterprise";
  const rawLimits = accessStatus.limits || {};
  const rawUsage = accessStatus.usage || {};
  const limits = { ...rawLimits, clients: rawLimits.clients ?? rawLimits.clients_total, stock: rawLimits.stock ?? rawLimits.stock_total, invoices_monthly: rawLimits.invoices_monthly ?? rawLimits.invoices };
  const usage = { ...rawUsage, clients: rawUsage.clients ?? rawUsage.clients_total, stock: rawUsage.stock ?? rawUsage.stock_total, invoices_monthly: rawUsage.invoices_monthly ?? rawUsage.invoices };
  // A workspace that already exceeds any limit must not keep using the app on that plan.
  const overLimitEntries = Object.entries(rawLimits).filter(([resource, rawLimit]) => {
    const limit = Number(rawLimit);
    const used = Number(rawUsage[resource] || 0);
    return Number.isFinite(limit) && limit > 0 && used > limit;
  });
  const overLimitDetails = overLimitEntries.map(([resource]) => `${resource}: ${rawUsage[resource]}/${rawLimits[resource]}`).join(", ");
  const overLimit = overLimitEntries.length > 0;
  useEffect(() => {
    if (planLoading) return;
    if (overLimitDetails) {
      const reason = `Your plan limit has been exceeded: ${planName} plan — ${overLimitDetails}. Upgrade to restore app access.`;
      setBlockReason(reason);
      setBlocked(true);
      setShowPaywall(true);
    } else if (String(blockReason || "").startsWith("Your plan limit has been exceeded:")) {
      setBlockReason("");
      setBlocked(false);
      setShowPaywall(false);
    }
  }, [planLoading, overLimitDetails, planName]);
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

  // Subscription state is read from the authoritative Supabase RPC after payment verification.
  // the Subscription record. Never trusts a client-supplied plan.
  const applySubscription = useCallback((data) => {
    setSubscription(data?.tier || "pro");
    setPlanName(data?.planName || "Pro");
    setAccessStatus((prev) => ({ ...prev, plan: data?.tier || "pro" }));
    setBlocked(false); setShowPaywall(false);
  }, []);

  const openPaywall = useCallback((reason = "") => { setBlockReason(reason); setBlocked(Boolean(reason)); setShowPaywall(true); }, []);
  const closePaywall = useCallback(() => {
    if (overLimit) return; // Over-limit workspaces stay locked until the plan is upgraded or brought back within limits.
    setShowPaywall(false); setBlocked(false); setBlockReason("");
  }, [overLimit]);

  return (
    <PaywallContext.Provider value={{ plan, limits, usage, remaining, requireFeature, refreshAccessStatus, isPremium, subscription, planName, planId, planStartedAt, planExpiresAt, planResetsAt, planLoading, requestAction, canAccess, applySubscription, upgrade: applySubscription, showPaywall, blocked, overLimit, openPaywall, closePaywall }}>
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
      "Lead Management (up to 200 leads)",
      "Expense Tracker",
      "Standard Customer Support",
    ],
    locked: ["WhatsApp sharing", "Team access and advanced CRM", "Payment reminders", "GSTR-1 export", "Custom logo", "Multi-currency", "Premium designs"],
  },
  {
    id: "pro_monthly", name: "Pro Monthly", price: 249, period: "month", amount: 24900, badge: "MOST POPULAR", accent: true,
    included: [
      "Up to 3,000 invoices per month",
      "Dynamic UPI QR Code & Online Payments",
      "WhatsApp One-Click Direct Share",
      "Ultra HD PDF Downloads with Custom Logo",
      "Advanced CRM with up to 50,000 leads",
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
      "Lead Management (up to 200 leads)",
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
  const { user, checkUserAuth } = useAuth();
  const [notice, setNotice] = useState("");
  const [billing, setBilling] = useState("monthly");
  const [billingCountryCode, setBillingCountryCode] = useState("IN");
  useEffect(() => {
    let active = true;
    const loadCountry = async () => {
      if (!user?.workspace_id) return;
      const { data, error } = await supabase.from("business_profile").select("country_code").eq("workspace_id", user.workspace_id).maybeSingle();
      if (!error && active) {
        const nextCountry = typeof data?.country_code === "string" && GLOBAL_BILLING[data.country_code] ? data.country_code : "IN";
        setBillingCountryCode(nextCountry);
        if (!GLOBAL_BILLING[nextCountry]?.yearly) setBilling("monthly");
      }
    };
    void loadCountry();
    return () => { active = false; };
  }, [user?.workspace_id]);
  const billingConfig = GLOBAL_BILLING[billingCountryCode] || GLOBAL_BILLING.IN;
  const billingLocale = getCountryByCode(billingCountryCode)?.locales?.[0] || "en";
  const [phone, setPhone] = useState(() => { const digits = String(user?.phone || "").replace(/\D/g, ""); return digits.length > 10 && digits.startsWith("91") ? digits.slice(-10) : digits; });
  const [phonePrompt, setPhonePrompt] = useState(false);
  const [pendingPlan, setPendingPlan] = useState(null);
  const [savingPhone, setSavingPhone] = useState(false);
  // Callers may accidentally pass an Error/object as the reason; never call string methods on it.
  const safeBlockReason = typeof blockReason === "string" ? blockReason : String(blockReason?.message || blockReason?.error || "");
  const activePlan = currentPlan?.planId ? PLANS.find((plan) => plan.id === currentPlan.planId) : null;
  const billingPeriod = billing === "yearly" && billingConfig.yearly ? "yearly" : "monthly";
  const visiblePlans = [
    { id: "free", name: "Free", price: formatPlanPrice(0, billingConfig.currency, billingLocale), period: billingPeriod === "monthly" ? "month" : "year", included: DISPLAY_PLANS.free.bullets, locked: [], accent: false, badge: null, checkoutPlan: null },
    { id: "basic", name: "Basic", price: formatPlanPrice(billingConfig[billingPeriod].basic, billingConfig.currency, billingLocale), period: billingPeriod === "monthly" ? "month" : "year", included: DISPLAY_PLANS.basic.bullets, locked: [], accent: false, badge: null, checkoutPlan: billingConfig.paymentEnabled ? PLANS.find((p) => p.id === (billingPeriod === "monthly" ? "basic_monthly" : "basic_yearly")) : null, paymentUnavailable: !billingConfig.paymentEnabled },
    { id: "pro", name: "Pro", price: formatPlanPrice(billingConfig[billingPeriod].pro, billingConfig.currency, billingLocale), period: billingPeriod === "monthly" ? "month" : "year", included: DISPLAY_PLANS.pro.bullets, locked: [], accent: true, badge: "MOST POPULAR", checkoutPlan: billingConfig.paymentEnabled ? PLANS.find((p) => p.id === (billingPeriod === "monthly" ? "pro_monthly" : "enterprise_yearly")) : null, paymentUnavailable: !billingConfig.paymentEnabled },
  ];

  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const startCheckout = async (plan) => {
    setCheckoutLoading(true);
    setNotice("");
    try {
      await startCashfreeCheckout({ planId: plan.id });
    } catch (error) {
      setNotice(error?.message || "Cashfree checkout could not be started. Please try again.");
      setCheckoutLoading(false);
    }
  };
  const validPhone = (value) => billingCountryCode === "IN" ? /^[0-9]{10}$/.test(value) : /^[0-9]{8,15}$/.test(value);
  const normalizePhone = (value) => {
    const digits = String(value || "").replace(/[^0-9]/g, "");
    return billingCountryCode === "IN" && digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
  };
  const checkout = async (plan) => {
    const normalized = normalizePhone(user?.phone || "");
    if (!validPhone(normalized)) {
      setPhone(user?.phone || "");
      setPendingPlan(plan);
      setPhonePrompt(true);
      setNotice("");
      return;
    }
    await startCheckout(plan);
  };
  const savePhoneAndContinue = async () => {
    const normalized = normalizePhone(phone);
    if (!validPhone(normalized)) {
      setNotice(billingCountryCode === "IN" ? "Please enter exactly 10 digits (without +91)." : "Please enter a valid phone number with 8 to 15 digits.");
      return;
    }
    setSavingPhone(true);
    setNotice("");
    try {
      const { data: currentAuth, error: currentAuthError } = await supabase.auth.getUser();
      if (currentAuthError || !currentAuth?.user) throw currentAuthError || new Error("Could not load your signed-in account.");
      const { error } = await supabase.auth.updateUser({ data: { ...(currentAuth.user.user_metadata || {}), phone: normalized } });
      if (error) throw error;
      const { data: refreshed, error: refreshError } = await supabase.auth.getUser();
      if (refreshError) throw refreshError;
      if (refreshed?.user?.user_metadata?.phone !== normalized) {
        throw new Error("Number was not confirmed as saved. Please try again.");
      }
      if (checkUserAuth) await checkUserAuth();
      setPhone(normalized);
      setPhonePrompt(false);
      const plan = pendingPlan;
      setPendingPlan(null);
      if (plan) await startCheckout(plan);
    } catch (error) {
      setNotice(error?.message || "Could not save your mobile number. Please try again.");
    } finally {
      setSavingPhone(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-[#1f1c35]/60 p-2 backdrop-blur-md sm:p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="paywall-title" className="flex max-h-[calc(100dvh-1rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-white shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-3xl">
        <div className="relative shrink-0 bg-gradient-to-br from-[#6D28D9] to-[#4c1d95] px-4 py-4 pr-14 text-white sm:p-6">
          {!blocked && <button onClick={onClose} className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 text-white hover:bg-white/25" aria-label="Close pricing" title="Close pricing"><X className="h-5 w-5" /></button>}
          <div className="flex items-center gap-2"><Sparkles className="h-4 w-4" /><span className="text-[10px] font-bold uppercase tracking-[0.18em]">Plivex Premium</span></div>
          <h3 id="paywall-title" className="mt-2 text-[20px] font-bold leading-tight sm:mt-3 sm:text-[22px]">{blocked ? "Upgrade required" : "Choose your plan"}</h3>
          <p className="mt-1.5 text-[12px] leading-relaxed text-white/85">{blocked ? "This action is not available on your " + (currentPlan?.planName || "Free") + " plan. " + safeBlockReason : "Choose the plan that fits your business. Free plan, no card needed."}</p>
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold">Free plan available · No card needed</div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-6 sm:py-5">
          {currentPlan?.active && (
            <CurrentPlanCard planName={currentPlan.planName} benefits={activePlan?.included || []} startedAt={currentPlan.startedAt} expiresAt={currentPlan.expiresAt} />
          )}
          <p className="mb-3 text-center text-xs text-slate-500">Billing country: {getCountryByCode(billingCountryCode)?.name || "India"} · {billingConfig.currency}</p>
          <div className="mb-4 flex items-center justify-center gap-2 rounded-xl bg-slate-100 p-1">
            <button onClick={() => setBilling("monthly")} className={`rounded-lg px-4 py-2 text-xs font-bold ${billing === "monthly" ? "bg-white text-[#6D28D9] shadow-sm" : "text-slate-500"}`}>Monthly</button>
            {billingConfig.yearly && <button onClick={() => setBilling("yearly")} className={`rounded-lg px-4 py-2 text-xs font-bold ${billing === "yearly" ? "bg-white text-[#6D28D9] shadow-sm" : "text-slate-500"}`}>Yearly</button>}
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {visiblePlans.map((plan) => (
              <div key={plan.id} className={`relative flex flex-col rounded-2xl border p-4 ${plan.accent ? "border-[#6D28D9] bg-[#6D28D9]/5" : "border-[#E5E7EB] bg-white"}`}>
                {plan.badge && <span className="absolute -top-2.5 right-3 rounded-full bg-[#6D28D9] px-2.5 py-0.5 text-[9px] font-bold text-white">{plan.badge}</span>}
                <div className="flex items-center gap-2"><p className="text-[13px] font-bold text-slate-900">{plan.name}</p></div>
                <p className="mt-2 text-[26px] font-bold leading-none text-slate-900">{plan.price}<span className="text-[12px] font-medium text-slate-400">/{plan.period}</span></p>
                <div className="mt-3 flex-1 space-y-1.5">{plan.included.map((item) => <div key={item} className="flex items-start gap-2 text-[11px] font-medium text-slate-700"><span className="mt-0.5 text-emerald-600">✓</span>{item}</div>)}</div>
                {plan.checkoutPlan ? <button onClick={() => checkout(plan.checkoutPlan)} disabled={checkoutLoading} className={`mt-4 w-full rounded-xl py-2.5 text-[12px] font-bold disabled:opacity-60 ${plan.accent ? "bg-[#6D28D9] text-white" : "border border-[#6D28D9] text-[#6D28D9]"}`}>{checkoutLoading ? "Connecting to Cashfree…" : `Pay with Cashfree · ${plan.price}/${plan.period}`}</button> : plan.paymentUnavailable ? <button type="button" disabled className="mt-4 w-full rounded-xl border border-amber-200 bg-amber-50 py-2.5 text-[11px] font-bold text-amber-700">Cashfree currency not enabled</button> : <button onClick={onClose} className="mt-4 w-full rounded-xl border border-slate-200 py-2.5 text-[12px] font-bold text-slate-600">{currentPlan?.plan === "free" ? "Current plan" : "Use Free plan"}</button>}
              </div>
            ))}
          </div>

          {notice && <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-700" role="alert">{notice}</p>}
        </div>

        <div className="shrink-0 border-t border-[#E5E7EB] bg-white px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4">
          {blocked ? (
            safeBlockReason.startsWith("Your plan limit has been exceeded:") ? (
              <p className="text-center text-[12px] font-semibold text-amber-700">Upgrade your plan to unlock Plivex again.</p>
            ) : (
              <button onClick={onClose} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-100 text-[13px] font-bold text-slate-700 hover:bg-slate-200"><X className="h-4 w-4" />Close pricing</button>
            )
          ) : (
            <button onClick={onClose} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#E5E7EB] bg-white text-[13px] font-bold text-slate-600 hover:bg-slate-50"><X className="h-4 w-4" />Close pricing · Maybe later</button>
          )}
        </div>
      </div>
      {phonePrompt && (
        <div className="fixed inset-0 z-[140] flex items-start justify-center overflow-y-auto overscroll-contain bg-slate-950/60 px-4 py-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center" role="dialog" aria-modal="true" aria-labelledby="cashfree-phone-title">
          <div className="relative my-auto max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto overscroll-contain rounded-2xl bg-white p-5 shadow-2xl sm:p-6">
            <button type="button" onClick={() => { setPhonePrompt(false); setPendingPlan(null); setNotice(""); }} aria-label="Close mobile number form" className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-violet-100 text-[#6D28D9]"><Sparkles className="h-7 w-7" /></div>
            <h4 id="cashfree-phone-title" className="mt-4 text-center text-lg font-bold text-slate-900">Add your mobile number</h4>
            <p className="mt-2 text-center text-sm leading-6 text-slate-600">{billingCountryCode === "IN" ? "Enter your 10-digit Indian mobile number." : "Enter your mobile number using 8 to 15 digits, including your country code if needed."} It will be saved to your Plivex account before Cashfree checkout. No OTP or SMS will be sent.</p>
            <label className="mt-5 block text-sm font-semibold text-slate-700">Mobile number
              <span className="mt-1.5 flex overflow-hidden rounded-xl border border-slate-200 bg-white focus-within:border-violet-500 focus-within:ring-2 focus-within:ring-violet-100">
                {billingCountryCode === "IN" && <span className="flex items-center border-r border-slate-200 bg-slate-50 px-4 text-sm text-slate-500">+91</span>}
                <input type="tel" inputMode="numeric" autoComplete="tel-national" maxLength={billingCountryCode === "IN" ? 10 : 15} value={phone.replace(/[^0-9]/g, "").slice(0, billingCountryCode === "IN" ? 10 : 15)} onChange={(event) => setPhone(event.target.value.replace(/[^0-9]/g, "").slice(0, billingCountryCode === "IN" ? 10 : 15))} placeholder="98765 43210" className="min-w-0 flex-1 px-3 py-3 text-base text-slate-900 outline-none" />
              </span>
            </label>
            {notice && <p className="mt-2 text-sm text-rose-600" role="alert">{notice}</p>}
            <button type="button" onClick={savePhoneAndContinue} disabled={savingPhone || checkoutLoading} className="mt-5 w-full rounded-xl bg-[#6D28D9] px-4 py-3.5 text-sm font-bold text-white disabled:opacity-60">{savingPhone ? "Saving number…" : "Save number & continue"}</button>
            <button type="button" onClick={() => { setPhonePrompt(false); setPendingPlan(null); setNotice(""); }} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}