import { useEffect, useMemo, useState } from "react";
import { backend as db, supabase, setRuntimeEdition } from "@/api/backendClient";
import { useAuth } from "@/lib/AuthContext";
import { COUNTRY_REGISTRY, getCountryByCode, getCountryFlag } from "@/global/countries/country-registry.js";

const DRAFT_KEY = "plivex:workspace-onboarding:draft";
function readDraft(key) { try { return JSON.parse(sessionStorage.getItem(key) || "{}"); } catch { return {}; } }

const USE_CASES = [
  ["billing", "Billing & invoicing"], ["inventory", "Inventory & stock"],
  ["accounting", "Accounting & expenses"], ["crm", "CRM & customer management"],
  ["business", "Complete business management"], ["explore", "Just exploring"],
];

export default function UnifiedWorkspaceOnboarding() {
  const { user } = useAuth();
  const draftKey = `${DRAFT_KEY}:${user?.id || "unknown"}`;
  const [step, setStep] = useState(() => Math.min(3, Number(readDraft(draftKey).step) || 0));
  const [businessName, setBusinessName] = useState(() => readDraft(draftKey).businessName || "");
  const [businessType, setBusinessType] = useState(() => readDraft(draftKey).businessType || "retail");
  const [phone, setPhone] = useState("");
  const [useCase, setUseCase] = useState(() => readDraft(draftKey).useCase || "business");
  const [countryCode, setCountryCode] = useState(() => readDraft(draftKey).countryCode || "");
  const [localeCode, setLocaleCode] = useState(() => readDraft(draftKey).localeCode || "");
  const [taxType, setTaxType] = useState("");
  const [taxNumber, setTaxNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const country = useMemo(() => getCountryByCode(countryCode), [countryCode]);
  const locales = country?.locales || [];
  const phoneCode = country?.phoneCode || "";

  // Keep non-sensitive progress in this browser tab so a refresh can resume setup.
  // Phone and tax registration numbers are intentionally not written to storage.
  useEffect(() => {
    try { sessionStorage.setItem(draftKey, JSON.stringify({ step, businessName, businessType, useCase, countryCode, localeCode })); } catch { /* onboarding can still proceed without storage */ }
  }, [draftKey, step, businessName, businessType, useCase, countryCode, localeCode]);

  const next = () => {
    setError("");
    if (step === 0 && !businessName.trim()) return setError("Enter your business name to continue.");
    if (step === 2 && (!country || !locales.includes(localeCode || locales[0]))) return setError("Choose a supported business country and regional format.");
    setStep((value) => Math.min(3, value + 1));
  };

  const createWorkspace = async () => {
    if (!businessName.trim() || !country || !locales.includes(localeCode || locales[0])) {
      setError("Complete the required business details first."); return;
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
        plivex_business_type: businessType,
        plivex_primary_use_case: useCase,
        ...(phone.trim() ? { phone: phone.trim() } : {}),
      };
      const { error: metadataError } = await supabase.auth.updateUser({ data: metadata });
      if (metadataError) throw metadataError;

      if (country.code === "IN") {
        const result = await db.functions.invoke("ensureOwnerRole", {
          countryCode: country.code, localeCode: selectedLocale, businessName: businessName.trim(),
        });
        if (!result?.data?.ok) throw new Error(result?.data?.error || "Your India workspace could not be created.");
      } else {
        const result = await db.functions.invoke("globalEnsureOwner", {
          countryCode: country.code, localeCode: selectedLocale, businessName: businessName.trim(),
        });
        if (!result?.data?.ok) throw new Error(result?.data?.error || "Your workspace could not be created.");
      }

      setRuntimeEdition(country.code === "IN" ? "india" : "global");

      if (taxType.trim() || taxNumber.trim()) {
        try {
          const taxResult = await db.functions.invoke("workspaceRecords", {
            table: "business_profile", action: "upsert",
            values: {
              tax_registration_type: taxType.trim() || null,
              tax_registration_number: taxNumber.trim() || null,
              tax_registration_status: taxNumber.trim() ? "registered" : "unregistered",
            },
          });
          if (taxResult?.error || !taxResult?.data?.record) throw taxResult?.error || new Error("Tax profile save was not confirmed.");
        } catch (taxError) {
          console.warn("Optional tax profile was not saved:", taxError);
          setError("Your workspace has been created safely, but the optional tax details were not saved. Tap Create my workspace again to retry; this will not create a duplicate workspace.");
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

  const steps = ["Your business", "How you'll use Plivex", "Business location", "Review & create"];
  return (
    <main className="min-h-[100dvh] bg-[#F8F7FC] px-3 py-5 text-slate-900 sm:grid sm:place-items-center sm:px-5 sm:py-10">
      <section className="mx-auto flex min-h-[min(760px,calc(100dvh-2.5rem))] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl">
        <header className="shrink-0 border-b border-slate-100 px-5 py-5 sm:px-8">
          <div className="flex items-center justify-between">
            <span className="text-lg font-black tracking-tight text-violet-700">Plivex</span>
            <span className="text-xs font-semibold text-slate-500">Workspace setup · {step + 1} of 4</span>
          </div>
          <div className="mt-4 flex gap-1.5" aria-label="Setup progress">
            {steps.map((label, index) => <div key={label} className={`h-1.5 flex-1 rounded-full ${index <= step ? "bg-violet-600" : "bg-slate-100"}`} />)}
          </div>
          <p className="mt-2 text-[11px] text-slate-400">{steps[step]}</p>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 sm:px-8 sm:py-8">
          {step === 0 && <>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Tell us about your business</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">We'll use these details to set up your workspace. You can update them later.</p>
            <label className="mt-7 block text-sm font-semibold">Business name <span className="text-rose-600">*</span>
              <input autoFocus required maxLength={160} value={businessName} onChange={event => setBusinessName(event.target.value)} placeholder="e.g. Sharma Traders" className="mt-2 h-12 w-full rounded-xl border border-slate-200 px-4 text-base outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100" />
            </label>
            <label className="mt-5 block text-sm font-semibold">Business type
              <select value={businessType} onChange={event => setBusinessType(event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                <option value="retail">Retail / shop</option><option value="wholesale">Wholesale / distribution</option><option value="services">Services / freelancer</option><option value="manufacturing">Manufacturing</option><option value="ecommerce">E-commerce</option><option value="other">Other</option>
              </select>
            </label>
          </>}
          {step === 1 && <>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">What would you like to manage?</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">Choose the main reason you're setting up Plivex. You can use other features too.</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {USE_CASES.map(([value, label]) => <button type="button" key={value} onClick={() => setUseCase(value)} className={`rounded-2xl border p-4 text-left text-sm font-semibold transition ${useCase === value ? "border-violet-500 bg-violet-50 text-violet-800 ring-2 ring-violet-100" : "border-slate-200 hover:border-violet-200"}`}>{label}</button>)}
            </div>
          </>}
          {step === 2 && <>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Where is your business based?</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">This sets your workspace's base currency and regional formats. It does not verify tax residency or guarantee local tax compliance.</p>
            <label className="mt-7 block text-sm font-semibold">Business country <span className="text-rose-600">*</span>
              <select required value={countryCode} onChange={event => { const nextCountry = getCountryByCode(event.target.value); setCountryCode(nextCountry?.code || ""); setLocaleCode(nextCountry?.locales?.[0] || ""); }} className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                <option value="">Select your country</option>
                {COUNTRY_REGISTRY.map(entry => <option key={entry.code} value={entry.code}>{getCountryFlag(entry.code)} {entry.name} · {entry.currencyCode}</option>)}
              </select>
            </label>
            {country && <>
              <label className="mt-5 block text-sm font-semibold">Phone number <span className="font-normal text-slate-400">(optional)</span>
                <span className="mt-2 flex h-12 overflow-hidden rounded-xl border border-slate-200 focus-within:border-violet-500">
                  <span className="flex items-center border-r border-slate-200 bg-slate-50 px-3 text-sm text-slate-500">{phoneCode}</span>
                  <input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={event => setPhone(event.target.value)} placeholder="Mobile number" className="min-w-0 flex-1 px-3 text-base outline-none" />
                </span>
              </label>
              <label className="mt-5 block text-sm font-semibold">Regional number and date format
                <select value={localeCode || locales[0]} onChange={event => setLocaleCode(event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                  {locales.map(locale => <option key={locale} value={locale}>{locale}</option>)}
                </select>
              </label>
              <div className="mt-4 rounded-xl bg-violet-50 p-4 text-sm text-violet-900">Your workspace base currency will be <strong>{country.currencyCode}</strong>. Base currency is available on every plan, including Free.</div>
            </>}
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-semibold">Tax registration type <span className="font-normal text-slate-400">(optional)</span><input value={taxType} onChange={event => setTaxType(event.target.value)} maxLength={32} placeholder="GST / VAT / Sales Tax" className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" /></label>
              <label className="block text-sm font-semibold">Tax registration number <span className="font-normal text-slate-400">(optional)</span><input value={taxNumber} onChange={event => setTaxNumber(event.target.value)} maxLength={80} placeholder="Registration number" className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" /></label>
            </div>
          </>}
          {step === 3 && <>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Review your workspace</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">Your workspace is created only after you confirm these details.</p>
            <dl className="mt-6 divide-y divide-slate-100 rounded-2xl border border-slate-200 px-4">
              {[["Business", businessName],["Business type", businessType],["Primary use", USE_CASES.find(item => item[0] === useCase)?.[1] || "Business management"],["Country", country ? country.name : "Not selected"],["Base currency", country?.currencyCode || "—"],["Regional format", localeCode || locales[0] || "—"],["Phone", phone.trim() || "Not provided"],["Tax registration", taxType || taxNumber ? [taxType, taxNumber].filter(Boolean).join(" · ") : "Not provided"]].map(([label, value]) => <div key={label} className="flex justify-between gap-4 py-3 text-sm"><dt className="text-slate-500">{label}</dt><dd className="max-w-[60%] break-words text-right font-semibold text-slate-900">{value}</dd></div>)}
            </dl>
          </>}
          {error && <p role="alert" className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
        </div>
        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-100 bg-white px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-8">
          <button type="button" onClick={() => { setError(""); setStep(value => Math.max(0, value - 1)); }} disabled={step === 0 || loading} className="min-h-11 rounded-xl border border-slate-200 px-5 text-sm font-semibold text-slate-600 disabled:opacity-40">Back</button>
          {step < 3 ? <button type="button" onClick={next} className="min-h-11 rounded-xl bg-violet-700 px-6 text-sm font-bold text-white hover:bg-violet-800">Continue</button> : <button type="button" onClick={createWorkspace} disabled={loading || !country} className="min-h-11 rounded-xl bg-violet-700 px-6 text-sm font-bold text-white disabled:opacity-60">{loading ? "Creating workspace…" : "Create my workspace"}</button>}
        </footer>
      </section>
    </main>
  );
}
