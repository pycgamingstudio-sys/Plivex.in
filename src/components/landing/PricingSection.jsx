import { Link } from "react-router-dom";
import { useState } from "react";
import { Check, Sparkles, Crown, X } from "lucide-react";
import { GLOBAL_BILLING, formatPlanPrice } from "@/global/billing/pricing.js";
import { getCountryByCode } from "@/global/countries/country-registry.js";

const PLANS = [
  { id: "free", name: "Free", accent: false, badge: null, tagline: "For getting started with no card needed.", included: ["30 invoices / month", "20 clients and stock items", "PDF downloads with Made with Plivex footer", "Basic invoicing and expense tracking"], locked: ["WhatsApp sharing", "Team and lead pipeline", "GSTR-1 export and custom logo"] },
  { id: "basic", name: "Basic", accent: false, badge: null, tagline: "For freelancers & small shops getting started.", included: ["GST & Non-GST invoicing", "Up to 100 invoices / month", "Dynamic UPI QR codes", "HD PDF downloads", "Basic client database", "Expense tracker", "Standard email support", "Zero watermark"], locked: ["WhatsApp one-click share", "Custom business logo", "Advanced reports"] },
  { id: "pro", name: "Pro", accent: true, badge: "MOST POPULAR", tagline: "For growing businesses that need everything.", included: ["Up to 3,000 invoices / month & quotations", "WhatsApp one-click sharing", "Custom branding & logos", "Advanced reports & GSTR-1 export", "Full client CRM & lead pipeline", "Multi-currency support", "Auto payment reminders"], locked: [] },
];

function getInitialBillingCountry() {
  try {
    const locales = [navigator.language, ...(navigator.languages || [])].filter(Boolean);
    for (const locale of locales) {
      const region = new Intl.Locale(locale).region;
      if (region && GLOBAL_BILLING[region]) return region;
    }
  } catch { /* use the safe default when locale detection is unavailable */ }
  return "IN";
}

export default function PricingSection() {
  const [countryCode, setCountryCode] = useState(getInitialBillingCountry);
  const [billing, setBilling] = useState("monthly");
  const country = GLOBAL_BILLING[countryCode];
  const countryInfo = getCountryByCode(countryCode);
  const locale = countryInfo?.locales?.[0] || "en";
  const hasYearly = Boolean(country?.yearly);
  const currency = country?.currency || "INR";

  const changeCountry = (value) => {
    setCountryCode(value);
    if (!GLOBAL_BILLING[value]?.yearly) setBilling("monthly");
  };

  return (
    <section id="pricing" className="fade-up scroll-mt-20">
      <div className="rounded-3xl border border-[#E5E7EB] bg-white p-5 shadow-sm sm:p-8">
        <div className="text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-[#6D28D9]/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[#6D28D9]"><Sparkles className="h-3 w-3" />Pricing</div>
          <h2 className="mt-3 text-[22px] font-bold text-slate-900 sm:text-[26px]">Simple, honest pricing for every business.</h2>
          <p className="mx-auto mt-1.5 max-w-xl text-[12px] text-slate-500">Free plan, no card needed. Upgrade when your business needs more.</p>
        </div>

        <div className="mx-auto mt-5 flex max-w-xs flex-col gap-1.5 text-left">
          <label htmlFor="pricing-country" className="text-xs font-semibold text-slate-700">Choose billing country</label>
          <select id="pricing-country" value={countryCode} onChange={(event) => changeCountry(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800">
            {Object.entries(GLOBAL_BILLING).map(([code, item]) => <option key={code} value={code}>{getCountryByCode(code)?.name || code} ({item.currency})</option>)}
          </select>
        </div>

        {hasYearly && <div className="mx-auto mt-4 flex w-fit items-center gap-1 rounded-xl bg-slate-100 p-1">
          <button type="button" onClick={() => setBilling("monthly")} className={`rounded-lg px-4 py-2 text-xs font-bold ${billing === "monthly" ? "bg-white text-[#6D28D9] shadow-sm" : "text-slate-500"}`}>Monthly</button>
          <button type="button" onClick={() => setBilling("yearly")} className={`rounded-lg px-4 py-2 text-xs font-bold ${billing === "yearly" ? "bg-white text-[#6D28D9] shadow-sm" : "text-slate-500"}`}>Yearly</button>
        </div>}

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {PLANS.map((plan) => {
            const amountMinor = plan.id === "free" ? 0 : country[billing === "yearly" ? "yearly" : "monthly"]?.[plan.id];
            const price = amountMinor === 0 ? formatPlanPrice(0, currency, locale) : Number.isSafeInteger(amountMinor) ? formatPlanPrice(amountMinor, currency, locale) : "Not available";
            return (
              <div key={plan.id} className={`relative flex flex-col rounded-2xl border p-5 ${plan.accent ? "border-[#6D28D9] bg-[#6D28D9]/5" : "border-[#E5E7EB] bg-white"}`}>
                {plan.badge && <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-[#6D28D9] px-3 py-0.5 font-mono-ui text-[9px] font-bold uppercase tracking-wider text-white">{plan.badge}</span>}
                <div className="flex items-center gap-2">
                  {plan.accent ? <Crown className="h-4 w-4 text-[#6D28D9]" /> : <Sparkles className="h-4 w-4 text-slate-400" />}
                  <p className="text-[14px] font-bold text-slate-900">{plan.name} Plan</p>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">{plan.tagline}</p>
                <div className="mt-3 flex items-end gap-1">
                  <p className="text-[28px] font-bold leading-none text-slate-900">{price}</p>
                  <span className="mb-0.5 text-[12px] font-medium text-slate-400">{plan.id === "free" ? "forever" : billing === "monthly" ? "/ month" : "/ year"}</span>
                </div>
                <p className="mt-1 text-[11px] font-semibold text-emerald-600">{plan.id === "free" ? "No card required" : billing === "yearly" ? "Annual billing" : "Monthly billing"}</p>
                <div className="mt-4 space-y-1.5">
                  {plan.included.map((feature) => <div key={feature} className="flex items-start gap-2 text-[11px] font-medium text-slate-700"><span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Check className="h-2.5 w-2.5" /></span>{feature}</div>)}
                  {plan.locked.map((feature) => <div key={feature} className="flex items-start gap-2 text-[11px] font-medium text-slate-400"><span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-500"><X className="h-2.5 w-2.5" /></span>{feature}</div>)}
                </div>
                <Link to="/register" className={`mt-5 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-[12px] font-bold transition-transform hover:-translate-y-0.5 ${plan.accent ? "bg-[#6D28D9] text-white" : "border border-[#6D28D9] text-[#6D28D9] hover:bg-[#6D28D9]/5"}`}>{plan.accent ? <Crown className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}Get {plan.name}</Link>
              </div>
            );
          })}
        </div>
        <p className="mt-4 text-center text-[10px] text-slate-400">Prices shown in {currency}. Applicable taxes, if any, are shown before payment.</p>
        {!country.paymentEnabled && <p role="status" className="mt-2 text-center text-xs text-amber-700">Cashfree checkout in {currency} is not enabled yet. Pricing is displayed, but payment will remain unavailable until Cashfree confirms this currency for the merchant account.</p>}
        <p className="mt-2 text-center text-[10px] text-slate-400">Secure checkout via Cashfree where the selected currency is enabled.</p>
      </div>
    </section>
  );
}
