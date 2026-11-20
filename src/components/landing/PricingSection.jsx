import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { usePaywall } from "@/lib/paywall";
import { Check, Sparkles, Crown, X } from "lucide-react";
import { GLOBAL_BILLING, formatPlanPrice, resolveWorkspaceBillingContext } from "@/global/billing/pricing.js";
import { getCountryByCode, getCountryFlag, COUNTRY_REGISTRY } from "@/global/countries/country-registry.js";

const PLANS = [
  { id: "free", name: "Free", accent: false, badge: null, tagline: "For getting started with no card needed.", included: ["30 invoices / month", "20 clients and stock items", "PDF downloads with Made with Plivex footer", "Basic invoicing and expense tracking"], locked: ["WhatsApp sharing", "Team and lead pipeline", "GSTR-1 export and custom logo"] },
  { id: "basic", name: "Basic", accent: false, badge: null, tagline: "For freelancers & small shops getting started.", included: ["GST & Non-GST invoicing", "Up to 100 invoices / month", "Dynamic UPI QR codes", "HD PDF downloads", "Basic client database", "Expense tracker", "Standard email support", "Zero watermark"], locked: ["WhatsApp one-click share", "Custom business logo", "Advanced reports"] },
  { id: "pro", name: "Pro", accent: true, badge: "MOST POPULAR", tagline: "For growing businesses that need everything.", included: ["Up to 3,000 invoices / month & quotations", "WhatsApp one-click sharing", "Custom branding & logos", "Advanced reports & GSTR-1 export", "Full client CRM & lead pipeline", "Multi-currency support", "Auto payment reminders"], locked: [] },
];

export default function PricingSection() {
  const { user, isAuthenticated } = useAuth();
  const { planName } = usePaywall();
  const [countryCode, setCountryCode] = useState("");
  const [countryTouched, setCountryTouched] = useState(false);
  useEffect(() => {
    if (isAuthenticated && !countryTouched && user?.country_code && GLOBAL_BILLING[user.country_code]) {
      setCountryCode(user.country_code);
    }
  }, [isAuthenticated, user?.country_code, user?.currency_code, countryTouched]);
  const [billing, setBilling] = useState("monthly");
  const activeCountryCode = isAuthenticated ? String(user?.country_code || "").trim().toUpperCase() : countryCode;
  const billingContext = resolveWorkspaceBillingContext(activeCountryCode, isAuthenticated ? user?.currency_code : "");
  const country = billingContext.ok ? billingContext.config : null;
  const countryInfo = getCountryByCode(activeCountryCode);
  const locale = countryInfo?.locales?.[0] || "en";
  const hasYearly = Boolean(country?.yearly);
  const currency = billingContext.ok ? billingContext.currencyCode : "";

  const changeCountry = (value) => {
    setCountryTouched(true);
    setCountryCode(value);
    if (!GLOBAL_BILLING[value]?.yearly) setBilling("monthly");
  };

  return (
    <section id="pricing" className="plivex-public-section fade-up">
      <div className="rounded-3xl border border-[#E8E7EF] bg-white p-4 shadow-[0_12px_40px_rgba(36,24,72,.06)] sm:p-8">
        <div className="text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-[#6D28D9]/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[#6D28D9]"><Sparkles className="h-3 w-3" />Pricing</div>
          <h2 className="mt-3 text-balance text-[22px] font-bold tracking-[-0.035em] text-slate-900 sm:text-[27px]">Simple, honest pricing for every business.</h2>
          <p className="mx-auto mt-1.5 max-w-xl text-[12px] leading-relaxed text-slate-600">Free plan, no card needed. Choose your country to see local pricing and currency.</p>
          {isAuthenticated && <p className="mt-2 text-[11px] font-semibold text-violet-700">Current plan: {planName || "Free"} · Workspace billing currency is shown below.</p>}
        </div>

        <div className="mx-auto mt-5 flex w-full max-w-sm flex-col gap-1.5 text-left">
          <label htmlFor="pricing-country" className="text-xs font-semibold text-slate-700">{isAuthenticated ? "Workspace country and billing currency" : "Select country to see pricing"}</label>
          <select id="pricing-country" disabled={isAuthenticated} value={activeCountryCode} onChange={(event) => changeCountry(event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 shadow-[0_1px_2px_rgba(15,23,42,.025)] focus:border-[#6D28D9] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/10">
            <option value="">🌍 Select your country</option>{COUNTRY_REGISTRY.filter(({ code }) => GLOBAL_BILLING[code]).map((entry) => <option key={entry.code} value={entry.code}>{getCountryFlag(entry.code)}  {entry.name} · {entry.currencyCode}</option>)}
          </select>
        </div>

        {country && hasYearly && <div className="mx-auto mt-4 flex w-fit items-center gap-1 rounded-xl bg-slate-100 p-1">
          <button type="button" onClick={() => setBilling("monthly")} className={`rounded-lg px-4 py-2 text-xs font-bold ${billing === "monthly" ? "bg-white text-[#6D28D9] shadow-sm" : "text-slate-500"}`}>Monthly</button>
          <button type="button" onClick={() => setBilling("yearly")} className={`rounded-lg px-4 py-2 text-xs font-bold ${billing === "yearly" ? "bg-white text-[#6D28D9] shadow-sm" : "text-slate-500"}`}>Yearly</button>
        </div>}

        {isAuthenticated && !billingContext.ok && <p role="alert" className="mx-auto mt-5 max-w-xl rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">Workspace country and base currency could not be verified. Plivex has not substituted Indian pricing.</p>}
        {!country ? <div className="mt-7 rounded-2xl border border-dashed border-[#D8CCF5] bg-[#FAF8FF] px-5 py-9 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-2xl shadow-sm">🌍</div><h3 className="mt-3 text-sm font-bold text-slate-900">Your pricing, in your currency</h3><p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-slate-500">Select your business country above to view the plans and prices available in your region.</p></div> : <><div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PLANS.map((plan) => {
            const amountMinor = plan.id === "free" ? 0 : country[billing === "yearly" ? "yearly" : "monthly"]?.[plan.id];
            const price = amountMinor === 0 ? formatPlanPrice(0, currency, locale) : Number.isSafeInteger(amountMinor) ? formatPlanPrice(amountMinor, currency, locale) : "Not available";
            return (
              <div key={plan.id} className={`plivex-hover-lift relative flex min-w-0 flex-col rounded-2xl border p-4 shadow-[0_1px_2px_rgba(24,24,40,.03)] transition-all sm:p-5 ${plan.accent ? "border-[#6D28D9] bg-gradient-to-br from-[#F7F3FF] via-white to-[#F0EBFF] shadow-[0_8px_28px_rgba(109,40,217,.10)]" : "border-[#E8E7EF] bg-gradient-to-br from-white to-[#FAFAFC]"}`}>
                {plan.badge && <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-[#6D28D9] px-3 py-0.5 font-mono-ui text-[9px] font-bold uppercase tracking-wider text-white">{plan.badge}</span>}
                <div className="flex items-center gap-2">
                  {plan.accent ? <Crown className="h-4 w-4 text-[#6D28D9]" /> : <Sparkles className="h-4 w-4 text-slate-400" />}
                  <p className="text-[14px] font-bold text-slate-900">{plan.name} Plan</p>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">{plan.tagline}</p>
                <div className="mt-3 flex items-end gap-1">
                  <p className="break-words text-[26px] font-bold leading-none tracking-[-0.04em] text-slate-900 sm:text-[29px]">{price}</p>
                  <span className="mb-0.5 text-[12px] font-medium text-slate-400">{plan.id === "free" ? "forever" : billing === "monthly" ? "/ month" : "/ year"}</span>
                </div>
                <p className="mt-1 text-[11px] font-semibold text-emerald-600">{plan.id === "free" ? "No card required" : billing === "yearly" ? "Annual billing" : "Monthly billing"}</p>
                <div className="mt-4 space-y-1.5">
                  {plan.included.map((feature) => <div key={feature} className="flex items-start gap-2 text-[11px] font-medium text-slate-700"><span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Check className="h-2.5 w-2.5" /></span>{feature}</div>)}
                  {plan.locked.map((feature) => <div key={feature} className="flex items-start gap-2 text-[11px] font-medium text-slate-400"><span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-500"><X className="h-2.5 w-2.5" /></span>{feature}</div>)}
                </div>
                <Link to="/register" className={`mt-5 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl py-2.5 text-[12px] font-bold transition-all hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6D28D9] ${plan.accent ? "bg-[#6D28D9] text-white shadow-sm hover:bg-[#5B21B6]" : "border border-[#D8CCF5] bg-white text-[#6D28D9] hover:border-[#6D28D9] hover:bg-[#F8F5FF]"}`}>{plan.accent ? <Crown className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}Get {plan.name}</Link>
              </div>
            );
          })}
        </div>
        <p className="mt-4 text-center text-[10px] text-slate-400">Prices shown in {currency}. Applicable taxes, if any, are shown before payment.</p>
        <p role="status" className="mt-2 text-center text-xs text-slate-500">International checkout is being prepared. Plan selection and payment activation will be available after Plivex confirms its payment provider for your region.</p></>}
      </div>
    </section>
  );
}
