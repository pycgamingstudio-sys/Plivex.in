import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Globe2, Loader2, X } from "lucide-react";
import { backend as db, APP_EDITION } from "@/api/backendClient";
import { useAuth } from "@/lib/AuthContext";
import { COUNTRY_REGISTRY, getCountryByCode } from "@/global/countries/country-registry.js";
import { formatCurrency, formatNumber } from "@/global/localization/number-format.js";

const RESET_COPY = {
  en: {
    title: "Permanently delete old business data?",
    intro: "Changing your country permanently deletes the current workspace and its business data. This cannot be undone.",
    data: "Invoices, customers, products, stock, expenses, quotations, leads, team access and business settings will be deleted.",
    preserved: "Your login account, email, password, subscription and payment history will be preserved.",
    type: "Type DELETE to confirm.",
    cancel: "Cancel — keep my current workspace",
    confirm: "Confirm & permanently delete",
  },
  hi: {
    title: "Purane business ka data hamesha ke liye delete hoga",
    intro: "Country badalne par aapka maujooda workspace aur uska business data hamesha ke liye delete ho jayega. Ise wapas nahi laya ja sakta.",
    data: "Invoices, customers, products, stock, expenses, quotations, leads, team access aur business settings delete ho jayenge.",
    preserved: "Aapka login account, email, password, subscription aur payment history safe rahenge.",
    type: "Confirm karne ke liye DELETE type karein.",
    cancel: "Cancel — purana workspace rakhein",
    confirm: "Confirm karein aur permanently delete karein",
  },
  es: {
    title: "¿Eliminar permanentemente los datos comerciales anteriores?",
    intro: "Al cambiar de país, se eliminarán permanentemente el espacio de trabajo actual y sus datos comerciales. Esta acción no se puede deshacer.",
    data: "Se eliminarán facturas, clientes, productos, inventario, gastos, cotizaciones, oportunidades, accesos del equipo y ajustes comerciales.",
    preserved: "Se conservarán tu cuenta, correo, contraseña, suscripción e historial de pagos.",
    type: "Escribe DELETE para confirmar.",
    cancel: "Cancelar — conservar el espacio actual",
    confirm: "Confirmar y eliminar permanentemente",
  },
  fr: {
    title: "Supprimer définitivement les anciennes données professionnelles ?",
    intro: "Le changement de pays supprimera définitivement l'espace de travail actuel et ses données professionnelles. Cette action est irréversible.",
    data: "Les factures, clients, produits, stocks, dépenses, devis, prospects, accès de l'équipe et paramètres seront supprimés.",
    preserved: "Votre compte, e-mail, mot de passe, abonnement et historique des paiements seront conservés.",
    type: "Saisissez DELETE pour confirmer.",
    cancel: "Annuler — conserver l'espace actuel",
    confirm: "Confirmer et supprimer définitivement",
  },
  ar: {
    title: "هل تريد حذف بيانات العمل القديمة نهائياً؟",
    intro: "سيؤدي تغيير البلد إلى حذف مساحة العمل الحالية وبياناتها نهائياً. لا يمكن التراجع عن هذا الإجراء.",
    data: "سيتم حذف الفواتير والعملاء والمنتجات والمخزون والمصروفات وعروض الأسعار والعملاء المحتملين وصلاحيات الفريق وإعدادات العمل.",
    preserved: "سيتم الاحتفاظ بحساب تسجيل الدخول والبريد الإلكتروني وكلمة المرور والاشتراك وسجل المدفوعات.",
    type: "اكتب DELETE للتأكيد.",
    cancel: "إلغاء — الاحتفاظ بمساحة العمل الحالية",
    confirm: "تأكيد الحذف نهائياً",
  },
  zh: {
    title: "永久删除旧业务数据？",
    intro: "更改国家/地区将永久删除当前工作区及其业务数据。此操作无法撤销。",
    data: "发票、客户、产品、库存、费用、报价、潜在客户、团队访问权限和业务设置都将被删除。",
    preserved: "您的登录账户、邮箱、密码、订阅和付款记录将予以保留。",
    type: "输入 DELETE 以确认。",
    cancel: "取消 — 保留当前工作区",
    confirm: "确认并永久删除",
  },
  ms: {
    title: "Padam data perniagaan lama secara kekal?",
    intro: "Menukar negara akan memadam ruang kerja semasa dan data perniagaannya secara kekal. Tindakan ini tidak boleh dibatalkan.",
    data: "Invois, pelanggan, produk, stok, perbelanjaan, sebut harga, prospek, akses pasukan dan tetapan perniagaan akan dipadam.",
    preserved: "Akaun log masuk, e-mel, kata laluan, langganan dan sejarah pembayaran anda akan dikekalkan.",
    type: "Taip DELETE untuk mengesahkan.",
    cancel: "Batal — kekalkan ruang kerja semasa",
    confirm: "Sahkan dan padam secara kekal",
  },
  ta: {
    title: "பழைய வணிகத் தரவை நிரந்தரமாக நீக்கவா?",
    intro: "நாட்டை மாற்றினால் தற்போதைய பணியிடமும் அதன் வணிகத் தரவும் நிரந்தரமாக நீக்கப்படும். இதை மீட்டெடுக்க முடியாது.",
    data: "விலைப்பட்டியல்கள், வாடிக்கையாளர்கள், பொருட்கள், இருப்பு, செலவுகள், மேற்கோள்கள், வாய்ப்புகள், குழு அணுகல் மற்றும் வணிக அமைப்புகள் நீக்கப்படும்.",
    preserved: "உங்கள் உள்நுழைவு கணக்கு, மின்னஞ்சல், கடவுச்சொல், சந்தா மற்றும் கட்டண வரலாறு பாதுகாக்கப்படும்.",
    type: "உறுதிப்படுத்த DELETE என தட்டச்சு செய்யவும்.",
    cancel: "ரத்து செய் — தற்போதைய பணியிடத்தை வைத்திரு",
    confirm: "உறுதிசெய்து நிரந்தரமாக நீக்கு",
  },
};

function getResetCopy(locale) {
  const language = String(locale || "en").split("-")[0].toLowerCase();
  return RESET_COPY[language] || RESET_COPY.en;
}

export default function WorkspaceCountrySettings({ lockCountry = false } = {}) {
  const { user } = useAuth();
  const isGlobalWorkspace = APP_EDITION === "global";
  const [savedCountry, setSavedCountry] = useState(null);
  const [savedLocale, setSavedLocale] = useState(null);
  const [countryCode, setCountryCode] = useState("");
  const [locale, setLocale] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [requestReason, setRequestReason] = useState("");
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [confirmationText, setConfirmationText] = useState("");
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
        const country = getCountryByCode(user?.country_code || record?.country_code);
        if (!active) return;
        const activeLocale = user?.locale_code || record?.locale_code || country?.locales?.[0];
        if (country && country.locales.includes(activeLocale)) {
          setSavedCountry(country.code);
          setSavedLocale(activeLocale);
          setCountryCode(country.code);
          setLocale(activeLocale);
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
      } catch (loadError) {
        if (active) setError(loadError?.message || "Workspace country could not be loaded. Please retry.");
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [user?.workspace_id, user?.country_code, user?.locale_code]);

  const selectedCountry = useMemo(() => getCountryByCode(countryCode), [countryCode]);
  const localeOptions = selectedCountry?.locales || [];
  const preview = selectedCountry && locale
    ? formatCurrency(1234.56, { currencyCode: selectedCountry.currencyCode, locale })
    : "";
  const countryChanged = Boolean(savedCountry && selectedCountry && selectedCountry.code !== savedCountry);
  const localeChanged = Boolean(savedLocale && locale && locale !== savedLocale);
  const resetCopy = getResetCopy(locale);

  const cancelCountryReset = () => {
    setShowResetConfirm(false);
    setConfirmationText("");
    setCountryCode(savedCountry || "");
    setLocale(savedLocale || "");
    setError("");
  };

  const onCountryChange = (value) => {
    const country = getCountryByCode(value);
    setCountryCode(country?.code || "");
    setLocale(country?.locales?.[0] || "");
    setMessage("");
    setError("");
    setShowResetConfirm(false);
    setConfirmationText("");
  };

  const saveTaxProfile = async () => {
    const response = await db.functions.invoke("workspaceRecords", {
      table: "business_profile",
      action: "upsert",
      values: {
        tax_registration_number: taxProfile.number.trim() || null,
        tax_registration_type: taxProfile.type.trim() || null,
        tax_registration_status: taxProfile.status,
        tax_registration_effective_from: taxProfile.effectiveFrom || null,
        tax_jurisdiction_code: taxProfile.jurisdiction.trim() || null,
      },
    });
    if (response?.error || !response?.data?.record) throw response?.error || new Error("Tax profile save failed");
    setSavedTaxProfile({ ...taxProfile });
  };

  const save = async () => {
    if (!user?.workspace_id || !selectedCountry || !selectedCountry.locales.includes(locale)) {
      setError("Choose a supported country and its locale.");
      return;
    }
    if (countryChanged) {
      setShowResetConfirm(true);
      setConfirmationText("");
      setError("");
      setMessage("");
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
      if (localeChanged) {
        if (isGlobalWorkspace) {
          const countrySave = await db.functions.invoke("globalUpdateWorkspaceCountry", {
            countryCode: savedCountry,
            localeCode: locale,
            reason: requestReason.trim() || null,
          });
          if (!countrySave?.data?.ok) throw new Error("Workspace language could not be saved.");
        } else {
          const regionSave = await db.functions.invoke("updateWorkspaceLocale", { localeCode: locale });
          if (regionSave?.error || !regionSave?.data?.ok) throw regionSave?.error || new Error("Workspace language could not be saved.");
        }
        setSavedLocale(locale);
      }
      await saveTaxProfile();
      setMessage("Workspace regional settings and tax profile saved.");
    } catch (saveError) {
      setError(saveError?.message || "Settings were not saved. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const confirmCountryReset = async () => {
    if (confirmationText.trim() !== "DELETE") return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await db.functions.invoke("resetWorkspaceCountry", {
        countryCode: selectedCountry.code,
        localeCode: locale,
        reason: requestReason.trim() || null,
        confirmationPhrase: "DELETE_MY_BUSINESS_DATA",
      });
      if (!result?.data?.ok) throw new Error("Country reset was not completed.");
      try { window.localStorage.removeItem("plivex.signup.region"); } catch { /* ignore */ }
      // A full reload re-resolves the server-maintained country before any
      // workspace cache or edition-specific data is hydrated.
      window.location.reload();
    } catch (resetError) {
      setError(resetError?.message || "Country reset could not be completed. Your workspace was not partially reset.");
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
      <p className="mt-1 text-xs text-muted-foreground">{lockCountry
        ? "Your business country is locked for this workspace."
        : "Choose the country where this business operates. A country change creates a fresh workspace and permanently removes the previous workspace's business data."}</p>

      {loading ? <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading workspace setting…</div> : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold">Business country
            <select className="mt-1 w-full rounded-lg border bg-background px-3 py-2.5 text-sm" value={countryCode} onChange={(event) => onCountryChange(event.target.value)} disabled={lockCountry}>
              <option value="">Select a country</option>
              {COUNTRY_REGISTRY.map((country) => <option key={country.code} value={country.code}>{country.name} ({country.currencyCode})</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold">Regional number and currency format
            <select className="mt-1 w-full rounded-lg border bg-background px-3 py-2.5 text-sm" value={locale} onChange={(event) => { setLocale(event.target.value); setMessage(""); }} disabled={!selectedCountry || lockCountry}>
              <option value="">Select locale</option>
              {localeOptions.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </div>
      )}

      {!lockCountry && savedCountry && (countryChanged || localeChanged) && (
        <label className="mt-3 block text-xs font-semibold">Reason for change (optional)
          <textarea maxLength={500} value={requestReason} onChange={(event) => setRequestReason(event.target.value)} className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" placeholder="Explain why the business country or language needs to change" />
        </label>
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
            <input maxLength={32} className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" value={taxProfile.jurisdiction} onChange={(event) => setTaxProfile((p) => ({ ...p, jurisdiction: event.target.value }))} placeholder="e.g. US-CA or CA-ON" />
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
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}{countryChanged ? "Change country" : "Save workspace settings"}
        </button>
        {savedCountry && <span className="text-xs text-muted-foreground">Saved: {getCountryByCode(savedCountry)?.name} · {savedLocale}</span>}
      </div>

      {showResetConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" role="presentation">
          <div className="w-full max-w-lg rounded-xl border bg-background p-5 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="country-reset-title">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 text-amber-700">
                <AlertTriangle className="h-5 w-5 shrink-0" />
                <h3 id="country-reset-title" className="text-base font-bold">{resetCopy.title}</h3>
              </div>
              <button type="button" onClick={cancelCountryReset} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Close confirmation">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-3 text-sm">{resetCopy.intro}</p>
            <p className="mt-2 text-sm font-medium">{resetCopy.data}</p>
            <p className="mt-3 rounded-lg bg-muted p-3 text-sm">{resetCopy.preserved}</p>
            {error && <p role="alert" className="mt-3 rounded-lg bg-destructive/10 p-3 text-xs text-destructive">{error}</p>}
            <p className="mt-4 text-xs font-semibold">{resetCopy.type}</p>
            <input value={confirmationText} onChange={(event) => setConfirmationText(event.target.value)} autoComplete="off" className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" placeholder="DELETE" />
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={cancelCountryReset} disabled={saving} className="rounded-lg border px-4 py-2 text-xs font-semibold disabled:opacity-50">{resetCopy.cancel}</button>
              <button type="button" onClick={confirmCountryReset} disabled={saving || confirmationText.trim() !== "DELETE"} className="inline-flex items-center justify-center gap-2 rounded-lg bg-destructive px-4 py-2 text-xs font-semibold text-destructive-foreground disabled:cursor-not-allowed disabled:opacity-50">
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{resetCopy.confirm}
              </button>
            </div>
          </div>
        </div>
      )}
      {message && <p role="status" className="mt-3 text-xs text-emerald-700">{message}</p>}
      {error && <p role="alert" className="mt-3 text-xs text-destructive">{error}</p>}
      <p className="mt-3 text-[11px] text-muted-foreground">Supported identities: India, United States, United Kingdom, UAE, Canada, Australia and Singapore. Country selection alone does not enable local tax, invoicing or payment compliance.</p>
    </section>
  );
}
