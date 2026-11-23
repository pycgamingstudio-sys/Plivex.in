import { useEffect, useState } from "react";
import { supabase } from "@/api/backendClient";

const initialForm = {
  legal_name: "", contact_name: "", email: "", phone: "", tax_registration_number: "",
  website: "", business_type: "", payment_terms: "net_30",
  address_line1: "", address_line2: "", city: "", region: "", postal_code: "", country_code: "IN",
};
const input = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100";
const countries = [
  ["IN","India"],["US","United States"],["GB","United Kingdom"],["AE","United Arab Emirates"],
  ["CA","Canada"],["AU","Australia"],["SG","Singapore"],
];

export default function SupplierPortalPage() {
  const token = new URLSearchParams(window.location.search).get("token") || "";
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [supplierName, setSupplierName] = useState("");
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let active = true;
    if (!/^[a-f0-9]{64}$/.test(token)) {
      setError("This supplier invitation link is invalid or expired.");
      setLoading(false);
      return () => { active = false; };
    }
    supabase.functions.invoke("global-supplier-portal", { body: { action: "portal.read", token } })
      .then(({ data, error: invokeError }) => {
        if (!active) return;
        if (invokeError || !data?.supplier) {
          setError("This supplier invitation link is invalid, expired or already used.");
          return;
        }
        const s = data.supplier;
        const address = s.address || {};
        setSupplierName(s.name || "");
        setForm({
          ...initialForm,
          legal_name: s.legal_name || s.name || "",
          contact_name: s.contact_name || "",
          email: s.email || "",
          phone: s.phone || "",
          tax_registration_number: s.tax_registration_number || "",
          website: s.website || "",
          business_type: s.business_type || "",
          payment_terms: s.payment_terms || "net_30",
          address_line1: address.line1 || "",
          address_line2: address.line2 || "",
          city: address.city || "",
          region: address.region || "",
          postal_code: address.postal_code || "",
          country_code: address.country_code || "IN",
        });
      })
      .catch(() => { if (active) setError("Supplier invitation could not be loaded. Please try again."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  const change = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    const profile = {
      legal_name: form.legal_name.trim(),
      contact_name: form.contact_name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || null,
      tax_registration_number: form.tax_registration_number.trim() || null,
      website: form.website.trim() || null,
      business_type: form.business_type.trim() || null,
      payment_terms: form.payment_terms || null,
      address: {
        line1: form.address_line1.trim(),
        line2: form.address_line2.trim(),
        city: form.city.trim(),
        region: form.region.trim(),
        postal_code: form.postal_code.trim(),
        country_code: form.country_code,
      },
    };
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("global-supplier-portal", { body: { action: "portal.submit", token, profile } });
      if (invokeError) {
        let message = invokeError.message || "Supplier profile could not be submitted.";
        try { const body = await invokeError.context?.clone?.json(); if (body?.error) message = body.error; } catch {}
        throw new Error(message);
      }
      if (data?.error) throw new Error(data.error);
      setSubmitted(true);
    } catch (submitError) {
      setError(submitError.message || "Supplier profile could not be submitted. Please retry.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#F7F5FC] px-4 py-10 text-slate-900">
      <div className="mx-auto max-w-2xl">
        <header className="mb-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-700 text-lg font-black text-white">P</div>
          <p className="mt-3 text-xs font-bold uppercase tracking-[0.18em] text-violet-700">Plivex supplier portal</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Complete your supplier profile</h1>
          <p className="mt-2 text-sm text-slate-500">{supplierName ? "Invitation from " + supplierName : "Secure supplier onboarding"}</p>
        </header>
        <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm sm:p-7">
          {loading ? <p className="py-12 text-center text-sm text-slate-500">Checking your invitation…</p>
            : submitted ? <div className="py-10 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">✓</div><h2 className="mt-4 text-xl font-bold">Profile submitted</h2><p className="mt-2 text-sm leading-6 text-slate-600">Your details have been sent to the business that invited you. They will review your supplier profile.</p></div>
            : error && !supplierName ? <div className="py-10 text-center"><h2 className="text-lg font-bold">Invitation unavailable</h2><p className="mt-2 text-sm text-slate-600">{error}</p></div>
            : <>
              <p className="mb-5 text-sm leading-6 text-slate-600">Please provide accurate business and contact details. Your information is shared only with the workspace that sent this invitation.</p>
              {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
              <form onSubmit={submit} className="space-y-5">
                <div><h2 className="text-sm font-bold">Business details</h2><div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-semibold text-slate-600 sm:col-span-2">Legal business name *<input required maxLength={200} className={input+" mt-1"} value={form.legal_name} onChange={(e)=>change("legal_name",e.target.value)}/></label>
                  <label className="text-xs font-semibold text-slate-600">Business type<input maxLength={100} className={input+" mt-1"} value={form.business_type} onChange={(e)=>change("business_type",e.target.value)} placeholder="Company, partnership, sole trader…"/></label>
                  <label className="text-xs font-semibold text-slate-600">Website<input type="url" pattern="https://.*" maxLength={200} className={input+" mt-1"} value={form.website} onChange={(e)=>change("website",e.target.value)} placeholder="https://example.com"/></label>
                  <label className="text-xs font-semibold text-slate-600 sm:col-span-2">Tax registration number<input maxLength={80} className={input+" mt-1"} value={form.tax_registration_number} onChange={(e)=>change("tax_registration_number",e.target.value)}/></label>
                </div></div>
                <div><h2 className="text-sm font-bold">Contact details</h2><div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-semibold text-slate-600">Contact person *<input required maxLength={160} className={input+" mt-1"} value={form.contact_name} onChange={(e)=>change("contact_name",e.target.value)}/></label>
                  <label className="text-xs font-semibold text-slate-600">Invitation email<input required type="email" maxLength={254} readOnly className={input+" mt-1 bg-slate-50"} value={form.email}/></label>
                  <label className="text-xs font-semibold text-slate-600 sm:col-span-2">Phone<input type="tel" maxLength={40} className={input+" mt-1"} value={form.phone} onChange={(e)=>change("phone",e.target.value)}/></label>
                </div></div>
                <div><h2 className="text-sm font-bold">Business address</h2><div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-semibold text-slate-600 sm:col-span-2">Address line 1<input maxLength={200} className={input+" mt-1"} value={form.address_line1} onChange={(e)=>change("address_line1",e.target.value)}/></label>
                  <label className="text-xs font-semibold text-slate-600 sm:col-span-2">Address line 2<input maxLength={200} className={input+" mt-1"} value={form.address_line2} onChange={(e)=>change("address_line2",e.target.value)}/></label>
                  <label className="text-xs font-semibold text-slate-600">City<input maxLength={100} className={input+" mt-1"} value={form.city} onChange={(e)=>change("city",e.target.value)}/></label>
                  <label className="text-xs font-semibold text-slate-600">State / Region<input maxLength={100} className={input+" mt-1"} value={form.region} onChange={(e)=>change("region",e.target.value)}/></label>
                  <label className="text-xs font-semibold text-slate-600">Postal code<input maxLength={30} className={input+" mt-1"} value={form.postal_code} onChange={(e)=>change("postal_code",e.target.value)}/></label>
                  <label className="text-xs font-semibold text-slate-600">Country<select className={input+" mt-1"} value={form.country_code} onChange={(e)=>change("country_code",e.target.value)}>{countries.map(([code,name])=><option key={code} value={code}>{name}</option>)}</select></label>
                </div></div>
                <div><h2 className="text-sm font-bold">Payment preferences</h2><label className="mt-3 block text-xs font-semibold text-slate-600">Preferred payment terms<select className={input+" mt-1"} value={form.payment_terms} onChange={(e)=>change("payment_terms",e.target.value)}><option value="due_on_receipt">Due on receipt</option><option value="net_7">Net 7 days</option><option value="net_15">Net 15 days</option><option value="net_30">Net 30 days</option><option value="net_45">Net 45 days</option><option value="net_60">Net 60 days</option><option value="custom">Custom / discuss</option></select></label></div>
                <div className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-500">Do not submit passwords, full payment-card details or other sensitive credentials through this form.</div>
                <button type="submit" disabled={saving} className="w-full rounded-lg bg-violet-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">{saving ? "Submitting…" : "Submit supplier profile"}</button>
              </form>
            </>}
        </section>
        <p className="mt-5 text-center text-xs text-slate-400">Secure one-time invitation · Expires after 7 days</p>
      </div>
    </main>
  );
}
