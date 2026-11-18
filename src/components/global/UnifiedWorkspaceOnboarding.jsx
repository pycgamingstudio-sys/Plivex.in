import { useEffect, useMemo, useState } from "react";
import { backend as db, supabase, setRuntimeEdition } from "@/api/backendClient";
import { useAuth } from "@/lib/AuthContext";
import { COUNTRY_REGISTRY, getCountryByCode, getCountryFlag } from "@/global/countries/country-registry.js";
import { getSuggestedWorkspaceFeatures } from "@/lib/workspaceFeatures";
import { Check, ChevronLeft, ChevronRight, Globe2, MapPin, Search, Sparkles, Store, UserRound, Building2, ShieldCheck } from "lucide-react";

const DRAFT_KEY = "plivex:workspace-onboarding:draft";
function readDraft(key) { try { return JSON.parse(sessionStorage.getItem(key) || "{}"); } catch { return {}; } }
const STEPS = ["Country & region", "Your business", "A local welcome", "Your work", "Review"];

export default function UnifiedWorkspaceOnboarding() {
  const { user } = useAuth();
  const draftKey = `${DRAFT_KEY}:${user?.id || "unknown"}`;
  const initial = useMemo(() => readDraft(draftKey), [draftKey]);
  const [step, setStep] = useState(() => Math.min(4, Math.max(0, Number(initial.step) || 0)));
  const [businessName, setBusinessName] = useState(() => initial.businessName || "");
  const [countryCode, setCountryCode] = useState(() => initial.countryCode || "");
  const [localeCode, setLocaleCode] = useState(() => initial.localeCode || "");
  const [phone, setPhone] = useState(() => initial.phone || "");
  const [taxType, setTaxType] = useState(() => initial.taxType || "");
  const [taxNumber, setTaxNumber] = useState(() => initial.taxNumber || "");
  const [workTypes, setWorkTypes] = useState(() => Array.isArray(initial.workTypes) ? initial.workTypes : []);
  const [features, setFeatures] = useState(() => Array.isArray(initial.features) ? initial.features : []);
  const [countrySearch, setCountrySearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const country = useMemo(() => getCountryByCode(countryCode), [countryCode]);
  const locales = country?.locales || [];
  const phoneCode = country?.phoneCode || "";
  const filteredCountries = useMemo(() => COUNTRY_REGISTRY.filter((item) =>
    `${item.name} ${item.code} ${item.currencyCode}`.toLowerCase().includes(countrySearch.trim().toLowerCase())
  ), [countrySearch]);

  useEffect(() => {
    try { sessionStorage.setItem(draftKey, JSON.stringify({ step, businessName, countryCode, localeCode, phone, taxType, taxNumber, workTypes, features })); }
    catch { /* Setup remains usable when browser storage is unavailable. */ }
  }, [draftKey, step, businessName, countryCode, localeCode, phone, taxType, taxNumber, workTypes, features]);

  // One primary workspace profile: Freelancer OR Business. Optional modules remain configurable later.
  const chooseWorkType = (type) => {
    const next = [type];
    setWorkTypes(next);
    setFeatures(getSuggestedWorkspaceFeatures(next, countryCode));
  };

  const next = () => {
    setError("");
    if (step === 0 && !country) return setError("Choose the country where your business is based.");
    if (step === 1 && !businessName.trim()) return setError("Please enter your business or professional workspace name.");
    if (step === 3 && workTypes.length === 0) return setError("Choose Freelancer or Business to personalize your workspace.");
    setStep((value) => Math.min(4, value + 1));
  };

  const createWorkspace = async () => {
    if (!businessName.trim() || !country || !locales.includes(localeCode || locales[0]) || workTypes.length === 0) {
      setError("Please complete the required details before creating your workspace."); return;
    }
    setLoading(true); setError("");
    try {
      const selectedLocale = localeCode || locales[0];
      const { data: current } = await supabase.auth.getUser();
      if (!current?.user) throw new Error("Your sign-in session expired. Please sign in again.");
      const previousMetadata = current.user.user_metadata || {};
      const metadata = {
        ...previousMetadata,
        full_name: businessName.trim().slice(0, 160),
        signup_country_code: country.code,
        signup_locale_code: selectedLocale,
        plivex_work_type: workTypes[0],
        plivex_work_types: workTypes,
        plivex_workspace_features: features,
        phone: phone.trim() || null,
      };
      const { error: metadataError } = await supabase.auth.updateUser({ data: metadata });
      if (metadataError) throw metadataError;

      // One canonical workspace provisioning endpoint serves every manually selected country.
      const result = await db.functions.invoke("ensureOwnerRole", {
        countryCode: country.code,
        localeCode: selectedLocale,
        businessName: businessName.trim(),
        businessType: workTypes[0],
        optionalFeatures: features,
      });
      if (!result?.data?.ok) throw new Error(result?.data?.error || "Your workspace could not be created.");
      setRuntimeEdition("india");

      if (taxType.trim() || taxNumber.trim()) {
        try {
          const taxResult = await db.functions.invoke("workspaceRecords", {
            table: "business_profile", action: "upsert",
            values: {
              tax_registration_type: taxType.trim() || null,
              tax_registration_number: taxNumber.trim() || null,
              tax_registration_status: taxNumber.trim() ? "pending" : "unregistered",
            },
          });
          if (taxResult?.error || !taxResult?.data?.record) throw taxResult?.error || new Error("Tax profile save was not confirmed.");
        } catch (taxError) {
          console.warn("Optional tax profile was not saved:", taxError);
          setError("Your workspace is ready, but the optional tax details were not saved. You can add them later in Business Profile.");
          setLoading(false);
          return;
        }
      }
      try { window.localStorage.removeItem("plivex.signup.region"); sessionStorage.removeItem(draftKey); } catch { /* best effort */ }
      window.location.reload();
    } catch (submitError) {
      setError(submitError?.message || "Workspace setup could not be completed. Your account remains safe; please retry.");
      setLoading(false);
    }
  };

  const selectedFeatureLabels = features.map((id) => ({
    quotations: "Quotations", expenses: "Expenses", crm: "Client CRM",
    leads: "Lead Tracker", inventoryWorkspace: "Warehouse & Operations", reports: "Reports",
  }[id] || id));

  return (
    <main className="min-h-[100dvh] bg-[#F8F7FC] px-3 py-5 text-slate-900 sm:grid sm:place-items-center sm:px-5 sm:py-10">
      <section className="mx-auto flex min-h-[min(780px,calc(100dvh-2.5rem))] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] border border-slate-200/80 bg-white shadow-[0_24px_80px_rgba(36,20,74,0.10)]">
        <header className="shrink-0 border-b border-slate-100 px-5 py-5 sm:px-8">
          <div className="flex items-center justify-between gap-3">
            <span className="text-lg font-black tracking-tight text-violet-700">Plivex</span>
            <span className="text-xs font-semibold text-slate-500">Workspace setup · {step + 1} of 5</span>
          </div>
          <div className="mt-4 flex gap-1.5" aria-label="Setup progress">
            {STEPS.map((label, index) => <div key={label} className={`h-1.5 flex-1 rounded-full transition-all duration-500 ${index <= step ? "bg-violet-600" : "bg-slate-100"}`} />)}
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400"><span>{STEPS[step]}</span><span>{[20, 30, 55, 80, 100][step]}% complete</span></div>
        </header>

        <div key={step} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 sm:px-8 sm:py-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
          {step === 0 && <>
            <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-50 text-violet-700"><Globe2 className="h-6 w-6" /></div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Choose your country.</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">Choose where your business or independent work is based. Plivex will configure your one Workspace for that country.</p>
            <div className="mt-5 rounded-2xl border border-violet-100 bg-violet-50/70 p-4 text-sm leading-6 text-violet-950">
              <div className="flex items-start gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-violet-700" /><div><p className="font-semibold">A quick note before you choose</p><p className="mt-1 text-violet-900/80">Your country sets your workspace's base currency, regional formats and country-specific settings. Changing it after workspace creation requires a controlled reset or migration and may affect existing records. Please review your selection before continuing.</p></div></div>
            </div>
            <label className="mt-6 flex h-12 items-center gap-2 rounded-xl border border-slate-200 px-3 focus-within:border-violet-500 focus-within:ring-2 focus-within:ring-violet-100">
              <Search className="h-4 w-4 text-slate-400" /><input value={countrySearch} onChange={(event) => setCountrySearch(event.target.value)} placeholder="Search countries or currency" className="min-w-0 flex-1 border-0 bg-transparent text-sm outline-none" aria-label="Search countries" />
            </label>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {filteredCountries.map((entry) => {
                const selected = countryCode === entry.code;
                return <button type="button" key={entry.code} onClick={() => { setCountryCode(entry.code); setLocaleCode(entry.locales[0]); }} aria-pressed={selected} className={`group flex min-h-[68px] items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-md ${selected ? "border-violet-500 bg-violet-50 ring-2 ring-violet-100 shadow-sm" : "border-slate-200 bg-white"}`}>
                  <span className="text-2xl" aria-hidden="true">{getCountryFlag(entry.code)}</span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-slate-900">{entry.name}</span><span className="mt-0.5 block text-xs text-slate-500">{entry.currencyCode} · {entry.phoneCode}</span></span>{selected && <Check className="h-5 w-5 text-violet-700" />}
                </button>;
              })}
            </div>
            {filteredCountries.length === 0 && <p className="mt-4 text-sm text-slate-500">No matching country found. Try another search.</p>}
            <p className="mt-4 text-xs leading-5 text-slate-400">Your country selection does not verify tax residency or guarantee local tax compliance.</p>
          </>}

          {step === 1 && <>
            <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-50 text-violet-700"><Store className="h-6 w-6" /></div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Let's set up your workspace.</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">Give your workspace a name. You can add your legal and billing details later.</p>
            <label className="mt-7 block text-sm font-semibold">Business or professional name <span className="text-rose-600">*</span>
              <input autoFocus required maxLength={160} value={businessName} onChange={(event) => setBusinessName(event.target.value)} placeholder="e.g. Sharma Traders" className="mt-2 h-13 w-full rounded-xl border border-slate-200 px-4 text-base outline-none transition focus:border-violet-500 focus:ring-4 focus:ring-violet-100" />
            </label>
          </>}

          {step === 2 && country && <>
            <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-50 text-violet-700"><MapPin className="h-6 w-6" /></div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-violet-700">{getCountryFlag(country.code)} {country.name}</p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Your {country.name} workspace is taking shape.</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">We've selected the regional defaults for your workspace. You can review them before setup is complete.</p>
            <div className="mt-5 rounded-2xl bg-gradient-to-br from-violet-700 to-violet-600 p-4 text-white shadow-lg shadow-violet-200/60">
              <p className="text-xs font-medium text-white/75">Workspace base currency</p><p className="mt-1 text-2xl font-bold">{country.currencyCode}</p><p className="mt-1 text-xs text-white/75">Regional format: {localeCode || locales[0]}</p>
            </div>
            <label className="mt-6 block text-sm font-semibold">Mobile number <span className="font-normal text-slate-400">(optional)</span>
              <span className="mt-2 flex h-12 overflow-hidden rounded-xl border border-slate-200 focus-within:border-violet-500"><span className="flex items-center border-r border-slate-200 bg-slate-50 px-3 text-sm text-slate-500">{phoneCode}</span><input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Your mobile number" className="min-w-0 flex-1 px-3 text-base outline-none" /></span>
            </label>
            <p className="mt-2 text-xs text-slate-400">You can skip this and add a number later in your account settings.</p>
            {locales.length > 1 && <label className="mt-5 block text-sm font-semibold">Regional number and date format<select value={localeCode || locales[0]} onChange={(event) => setLocaleCode(event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">{locales.map((locale) => <option key={locale} value={locale}>{locale}</option>)}</select></label>}
            <div className="mt-5 grid gap-3 sm:grid-cols-2"><label className="block text-sm font-semibold">Tax registration type <span className="font-normal text-slate-400">(optional)</span><input value={taxType} onChange={(event) => setTaxType(event.target.value)} maxLength={32} placeholder="GST / VAT / Sales Tax" className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" /></label><label className="block text-sm font-semibold">Tax registration number <span className="font-normal text-slate-400">(optional)</span><input value={taxNumber} onChange={(event) => setTaxNumber(event.target.value)} maxLength={80} placeholder="Registration number" className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" /></label></div>
          </>}

          {step === 3 && <>
            <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-50 text-violet-700"><Sparkles className="h-6 w-6" /></div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">What's your work based on?</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">Choose one primary profile. You can add optional tools later through More Features.</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={() => chooseWorkType("freelancer")} aria-pressed={workTypes.includes("freelancer")} className={`rounded-2xl border p-5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${workTypes.includes("freelancer") ? "border-violet-500 bg-violet-50 ring-2 ring-violet-100" : "border-slate-200 hover:border-violet-200"}`}><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><UserRound className="h-5 w-5" /></span><span className="mt-4 block text-base font-bold">Freelancer</span><span className="mt-1 block text-xs leading-5 text-slate-500">For independent professionals and service providers managing clients, quotations, expenses and follow-ups.</span>{workTypes.includes("freelancer") && <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-violet-700"><Check className="h-4 w-4" />Selected</span>}</button>
              <button type="button" onClick={() => chooseWorkType("business")} aria-pressed={workTypes.includes("business")} className={`rounded-2xl border p-5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${workTypes.includes("business") ? "border-violet-500 bg-violet-50 ring-2 ring-violet-100" : "border-slate-200 hover:border-violet-200"}`}><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-100 text-blue-700"><Building2 className="h-5 w-5" /></span><span className="mt-4 block text-base font-bold">Business</span><span className="mt-1 block text-xs leading-5 text-slate-500">For shops and growing teams that manage sales, purchases, stock, warehouses and operations.</span>{workTypes.includes("business") && <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-violet-700"><Check className="h-4 w-4" />Selected</span>}</button>
            </div>
            <p className="mt-4 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-500">Your dashboard recommendations will follow this choice. You can add or remove optional features at any time. Invoices and Quotations are available in every workspace. Business profiles also include Stock Inventory and Team Members. You can add or remove optional tools later.</p>
            <p className="mt-3 text-xs font-medium text-violet-700">Suggested tools: {features.length ? selectedFeatureLabels.join(" · ") : "Choose a work type to see recommendations."}</p>
          </>}

          {step === 4 && <>
            <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><Check className="h-6 w-6" /></div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Your workspace is ready to be created.</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">Review your details. Plivex will configure your dashboard and regional settings after you confirm.</p>
            <dl className="mt-6 divide-y divide-slate-100 rounded-2xl border border-slate-200 px-4">
              {[
                ["Workspace", businessName], ["Country", country ? `${getCountryFlag(country.code)} ${country.name}` : "Not selected"],
                ["Base currency", country?.currencyCode || "—"], ["Work type", workTypes.map((type) => type === "freelancer" ? "Freelancer" : "Business").join(" + ")],
                ["Mobile", phone.trim() || "Skipped"], ["Optional features", selectedFeatureLabels.join(", ") || "None selected"],
                ["Tax registration", taxType || taxNumber ? [taxType, taxNumber].filter(Boolean).join(" · ") : "Not provided"],
              ].map(([label, value]) => <div key={label} className="flex justify-between gap-4 py-3 text-sm"><dt className="text-slate-500">{label}</dt><dd className="max-w-[62%] break-words text-right font-semibold text-slate-900">{value}</dd></div>)}
            </dl>
          </>}
          {error && <p role="alert" className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-100 bg-white px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-8">
          <button type="button" onClick={() => { setError(""); setStep((value) => Math.max(0, value - 1)); }} disabled={step === 0 || loading} className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"><ChevronLeft className="h-4 w-4" />Back</button>
          {step === 2 && <button type="button" onClick={() => { setPhone(""); setError(""); }} disabled={loading} className="min-h-11 rounded-xl px-3 text-xs font-semibold text-slate-500 transition hover:bg-slate-50">Skip mobile number</button>}
          {step < 4 ? <button type="button" onClick={next} disabled={loading} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-700 px-6 text-sm font-bold text-white shadow-md shadow-violet-200 transition hover:-translate-y-0.5 hover:bg-violet-800 disabled:opacity-60">Continue<ChevronRight className="h-4 w-4" /></button> : <button type="button" onClick={createWorkspace} disabled={loading || !country || !workTypes.length} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-700 px-6 text-sm font-bold text-white shadow-md shadow-violet-200 transition hover:-translate-y-0.5 hover:bg-violet-800 disabled:opacity-60">{loading ? "Creating workspace…" : "Create my workspace"}<Sparkles className="h-4 w-4" /></button>}
        </footer>
      </section>
    </main>
  );
}
