import React, { useMemo, useState } from "react";
import { backend as db, supabase } from "@/api/backendClient";
import { COUNTRY_REGISTRY, getCountryByCode } from "@/global/countries/country-registry.js";

export default function UnifiedCountryOnboarding() {
  const [countryCode, setCountryCode] = useState("");
  const [localeCode, setLocaleCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const country = useMemo(() => getCountryByCode(countryCode), [countryCode]);
  const locales = country?.locales || [];

  const handleContinue = async (event) => {
    event.preventDefault();
    setError("");
    if (!country) {
      setError("Please choose your business country.");
      return;
    }
    const selectedLocale = localeCode || country.locales[0];
    if (!country.locales.includes(selectedLocale)) {
      setError("Please choose a supported language and number format.");
      return;
    }

    setLoading(true);
    try {
      const edition = country.code === "IN" ? "india" : "global";
      const { error: metadataError } = await supabase.auth.updateUser({
        data: {
          plivex_runtime_edition: edition,
          signup_country_code: country.code,
          signup_locale_code: selectedLocale,
        },
      });
      if (metadataError) throw metadataError;

      const response = edition === "india"
        ? await db.functions.invoke("ensureOwnerRole", {
            reset: true,
            countryCode: country.code,
            localeCode: selectedLocale,
          })
        : await db.functions.invoke("globalEnsureOwner", {
            countryCode: country.code,
            localeCode: selectedLocale,
          });
      if (!response?.data?.ok) {
        throw new Error(response?.data?.error || "Your workspace could not be initialized.");
      }
      window.location.reload();
    } catch (submitError) {
      setError(submitError?.message || "Could not save your business country. Please try again.");
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#F8F7FC] px-4 py-10 flex items-center justify-center text-slate-900">
      <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-6">
          <p className="text-sm font-semibold text-violet-700">Plivex</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">Where is your business based?</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Choose your business country and language. Plivex will open the matching workspace after setup.
          </p>
        </div>
        <form onSubmit={handleContinue} className="space-y-5">
          <div className="space-y-2">
            <label htmlFor="unified-business-country" className="text-sm font-medium">Business country</label>
            <select
              id="unified-business-country"
              required
              value={countryCode}
              onChange={(event) => {
                const next = getCountryByCode(event.target.value);
                setCountryCode(next?.code || "");
                setLocaleCode(next?.locales?.[0] || "");
              }}
              className="h-12 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
            >
              <option value="">Select your country</option>
              {COUNTRY_REGISTRY.map((entry) => (
                <option key={entry.code} value={entry.code}>{entry.name}</option>
              ))}
            </select>
          </div>
          {country && (
            <div className="space-y-2">
              <label htmlFor="unified-business-locale" className="text-sm font-medium">Language and number format</label>
              <select
                id="unified-business-locale"
                value={localeCode || country.locales[0]}
                onChange={(event) => setLocaleCode(event.target.value)}
                className="h-12 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
              >
                {locales.map((locale) => <option key={locale} value={locale}>{locale}</option>)}
              </select>
              <p className="text-xs text-slate-500">Workspace currency: {country.currencyCode}</p>
            </div>
          )}
          <p className="text-xs leading-5 text-slate-500">
            Country and language are separate preferences. This choice does not establish tax residency or guarantee local tax compliance.
          </p>
          {error && <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          <button
            type="submit"
            disabled={loading || !country}
            className="h-12 w-full rounded-md bg-violet-700 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Setting up your workspace..." : "Continue"}
          </button>
        </form>
      </section>
    </main>
  );
}
