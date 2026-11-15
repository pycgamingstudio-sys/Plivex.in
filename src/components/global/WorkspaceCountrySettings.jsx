import { useEffect, useMemo, useState } from "react";
import { Check, Globe2, Loader2 } from "lucide-react";
import { backend as db } from "@/api/backendClient";
import { useAuth } from "@/lib/AuthContext";
import { COUNTRY_REGISTRY, getCountryByCode } from "@/global/countries/country-registry.js";
import { formatCurrency, formatNumber } from "@/global/localization/number-format.js";

export default function WorkspaceCountrySettings({ lockCountry = false } = {}) {
  const { user } = useAuth();
  const [savedCountry, setSavedCountry] = useState(null);
  const [savedLocale, setSavedLocale] = useState(null);
  const [countryCode, setCountryCode] = useState("");
  const [locale, setLocale] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [taxProfile, setTaxProfile] = useState({ number: "", type: "", status: "unregistered", effectiveFrom: "", jurisdiction: "" });
  const [savedTaxProfile, setSavedTaxProfile] = useState({ number: "", type: "", status: "unregistered", effectiveFrom: "", jurisdiction: "" });

  useEffect(() => {
    let active = true;
    async function load() {
      if (!user?.workspace_id) { setLoading(false); return; }
      try {
        const response = await db.functions.invoke("workspaceRecords", { table: "business_profile", action: "get" });
        if (response?.error) throw response.error;
        const record = response?.data?.record;
        const country = getCountryByCode(record?.country_code);
        if (!active) return;
        if (country && country.locales.includes(record?.locale_code)) {
          setSavedCountry(country.code);
          setSavedLocale(record.locale_code);
          setCountryCode(country.code);
          setLocale(record.locale_code);
        }
        const loadedTaxProfile = {
          number: record?.tax_registration_number || "",
          type: record?.tax_registration_type || "",
          status: record?.tax_registration_status || "unregistered",
          effectiveFrom: record?.tax_registration_effective_from || "",
          jurisdiction: record?.tax_jurisdiction_code || "",
        };
        setTaxProfile(loadedTaxProfile);
        setSavedTaxProfile(loadedTaxProfile);
      } catch {
        if (active) setError("Workspace country could not be loaded. Please retry.");
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [user?.workspace_id]);

  const selectedCountry = useMemo(() => getCountryByCode(countryCode), [countryCode]);
  const localeOptions = selectedCountry?.locales || [];
  const preview = selectedCountry && locale
    ? formatCurrency(1234.56, { currencyCode: selectedCountry.currencyCode, locale })
    : "";

  const onCountryChange = (value) => {
    const country = getCountryByCode(value);
    setCountryCode(country?.code || "");
    setLocale(country?.locales?.[0] || "");
    setMessage("");
    setError("");
  };

  const save = async () => {
    if (!user?.workspace_id || !selectedCountry || !selectedCountry.locales.includes(locale)) {
      setError("Choose a supported country and its locale.");
      return;
    }
    if (taxProfile.status === "registered" && (!taxProfile.number.trim() || !taxProfile.effectiveFrom)) {
      setError("Registered businesses must enter their tax registration number and effective date.");
      return;
    }
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await db.functions.invoke("workspaceRecords", {
        table: "business_profile",
        action: "upsert",
        values: {
          ...(lockCountry ? {} : { country_code: selectedCountry.code, locale_code: locale }),
          tax_registration_number: taxProfile.number.trim() || null,
          tax_registration_type: taxProfile.type.trim() || null,
          tax_registration_status: taxProfile.status,
          tax_registration_effective_from: taxProfile.effectiveFrom || null,
          tax_jurisdiction_code: taxProfile.jurisdiction.trim() || null,
        },
      });
      if (response?.error || !response?.data?.record) throw response?.error || new Error("Save failed");
      setSavedCountry(selectedCountry.code);
      setSavedLocale(locale);
      setSavedTaxProfile({ ...taxProfile });
      setMessage("Workspace country and tax profile saved.");
    } catch {
      setError("Country was not saved. Check your workspace permission and try again.");
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = (!lockCountry && (countryCode !== (savedCountry || "") || locale !== (savedLocale || "")))
    || JSON.stringify(taxProfile) !== JSON.stringify(savedTaxProfile);

  return (
    <section className="rounded-xl border bg-card p-5" aria-labelledby="workspace-country-title">
      <div className="flex items-center gap-2">
        <Globe2 className="h-4 w-4 text-primary" />
        <h2 id="workspace-country-title" className="text-sm font-bold">Workspace country & regional format</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{lockCountry ? "Your Global business country and currency were set during onboarding. You can manage the business tax registration details below." : "Choose where this business is based. This controls workspace currency defaults and country-specific invoice formats. Tax registration and transaction details remain business-supplied; Plivex does not independently verify tax obligations or registration."}</p>
      {loading ? <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading workspace setting…</div> : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold">Business country
            <select className="mt-1 w-full rounded-lg border bg-background px-3 py-2.5 text-sm" value={countryCode} onChange={(event) => onCountryChange(event.target.value)} disabled={lockCountry}>
              <option value="">Select a country</option>
              {COUNTRY_REGISTRY.map((country) => <option key={country.code} value={country.code}>{country.name} ({country.currencyCode})</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold">Number and currency locale
            <select className="mt-1 w-full rounded-lg border bg-background px-3 py-2.5 text-sm" value={locale} onChange={(event) => { setLocale(event.target.value); setMessage(""); }} disabled={!selectedCountry || lockCountry}>
              <option value="">Select locale</option>
              {localeOptions.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </div>
      )}
      <div className="mt-5 border-t pt-4">
        <h3 className="text-sm font-bold">Business tax registration</h3>
        <p className="mt-1 text-xs text-muted-foreground">Enter the registration details issued to this business. Plivex does not verify registration with tax authorities.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold">Registration status
            <select className="mt-1 w-full rounded-lg border bg-background px-3 py-2.5 text-sm" value={taxProfile.status} onChange={(event) => setTaxProfile((p) => ({ ...p, status: event.target.value }))}>
              <option value="unregistered">Unregistered</option>
              <option value="pending">Pending</option>
              <option value="registered">Registered</option>
              <option value="deregistered">Deregistered</option>
            </select>
          </label>
          <label className="text-xs font-semibold">Registration type (GST / VAT / Sales Tax / HST / PST)
            <input maxLength={32} className="mt-1 w-full rounded-lg border bg-background px-3 py-2.5 text-sm" value={taxProfile.type} onChange={(event) => setTaxProfile((p) => ({ ...p, type: event.target.value }))} placeholder="e.g. VAT" />
          </label>
          <label className="text-xs font-semibold">Tax registration number
            <input maxLength={80} className="mt-1 w-full rounded-lg border bg-background px-3 py-2.5 text-sm" value={taxProfile.number} onChange={(event) => setTaxProfile((p) => ({ ...p, number: event.target.value }))} placeholder="Enter official registration number" />
          </label>
          <label className="text-xs font-semibold">Registration effective from
            <input type="date" className="mt-1 w-full rounded-lg border bg-background px-3 py-2.5 text-sm" value={taxProfile.effectiveFrom} onChange={(event) => setTaxProfile((p) => ({ ...p, effectiveFrom: event.target.value }))} />
          </label>
          <label className="text-xs font-semibold sm:col-span-2">Registered tax jurisdiction (state / province / local code)
            <input maxLength={32} className="mt-1 w-full rounded-lg border bg-background px-3 py-2.5 text-sm" value={taxProfile.jurisdiction} onChange={(event) => setTaxProfile((p) => ({ ...p, jurisdiction: event.target.value }))} placeholder="e.g. US-CA or CA-ON" />
          </label>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">For the USA and Canada, this registration jurisdiction is not a substitute for the customer's place of supply, address-level tax lookup, or seller collection-obligation checks.</p>
      </div>
      {selectedCountry && locale && <div className="mt-3 rounded-lg bg-muted/50 p-3 text-xs">
        <p className="font-semibold">Display preview</p>
        <p className="mt-1">{preview} · {formatNumber(1234567.89, { locale })}</p>
        <p className="mt-1 text-muted-foreground">Currency: {selectedCountry.currencyCode}. No conversion is performed.</p>
      </div>}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={loading || saving || !hasChanges || !selectedCountry || !locale} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}{lockCountry ? "Save tax registration" : "Confirm and save country"}
        </button>
        {savedCountry && <span className="text-xs text-muted-foreground">Saved: {getCountryByCode(savedCountry)?.name} · {savedLocale}</span>}
      </div>
      {message && <p role="status" className="mt-3 text-xs text-emerald-700">{message}</p>}
      {error && <p role="alert" className="mt-3 text-xs text-destructive">{error}</p>}
      <p className="mt-3 text-[11px] text-muted-foreground">Supported identities: India, United States, United Kingdom, UAE, Canada, Australia and Singapore. Country selection alone does not enable local tax, invoicing or payment compliance.</p>
    </section>
  );
}
