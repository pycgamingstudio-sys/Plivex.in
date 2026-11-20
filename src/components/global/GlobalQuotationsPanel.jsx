import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, Plus, Download, ArrowRight, CheckCircle2, XCircle, Send } from "lucide-react";
import { jsPDF } from "jspdf";
import { supabase } from "@/api/backendClient";
import { calculateInvoiceGlobalTax } from "@/global/tax/invoice-tax-integration.js";

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const digits = (currency) => {
  try { return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits; }
  catch { return 2; }
};
const minor = (amount, currency) => Math.round(Number(amount || 0) * (10 ** digits(currency)));
const formatMoney = (amount, currency, locale) => new Intl.NumberFormat(locale || "en", {
  style: "currency", currency: currency || "USD",
}).format(Number(amount || 0) / (10 ** digits(currency || "USD")));
const field = "w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100";
const primary = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50";
const secondary = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50";
const statusTone = {
  draft: "bg-slate-100 text-slate-700",
  sent: "bg-blue-50 text-blue-700",
  accepted: "bg-emerald-50 text-emerald-700",
  rejected: "bg-rose-50 text-rose-700",
  expired: "bg-amber-50 text-amber-800",
  converted: "bg-violet-50 text-violet-700",
};
const newId = () => crypto.randomUUID();

export default function GlobalQuotationsPanel({ account }) {
  const currency = account?.currency_code || "USD";
  const locale = account?.locale_code || "en";
  const countryCode = String(account?.country_code || "").trim().toUpperCase();
  const [records, setRecords] = useState([]);
  const [profile, setProfile] = useState(null);
  const [taxContext, setTaxContext] = useState({
    countryCode, mode: "automatic", priceMode: "exclusive", taxMode: "taxable", noTaxConfirmed: false, noTaxConfirmed: false,
    taxTreatment: "standard", taxCategory: "standard-rated", taxDetailsConfirmed: false,
    placeOfSupply: "", destinationJurisdiction: { province: "" }, collectionObligationAttested: false,
  });
  const [clients, setClients] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState({
    client_id: "", issue_date: today(), valid_until: "", notes: "",
    items: [{ description: "", quantity: "1", unit_price: "", discount: "0" }],
  });

  const request = useCallback(async (payload) => {
    if (!account?.workspace_id) throw new Error("Your Global workspace is not ready.");
    const { data, error: invokeError } = await supabase.functions.invoke("global-quotations", {
      body: { ...payload, workspace_id: account.workspace_id },
    });
    if (invokeError) {
      let message = invokeError.message || "Quotation request failed.";
      try {
        const response = await invokeError.context?.clone?.json();
        if (typeof response?.error === "string") message = response.error;
      } catch { /* keep SDK message */ }
      throw new Error(message);
    }
    if (!data?.ok) throw new Error(data?.error || "Quotation request failed.");
    return data;
  }, [account?.workspace_id]);

  const refresh = useCallback(async () => {
    const [quotationData, clientData, profileData] = await Promise.all([
      request({ action: "list" }),
      supabase.functions.invoke("global-business-records", {
        body: { workspace_id: account.workspace_id, table: "clients", action: "list", limit: 100 },
      }),
      supabase.functions.invoke("global-business-records", {
        body: { workspace_id: account.workspace_id, table: "business_profiles", action: "list", limit: 5 },
      }),
    ]);
    if (clientData.error) throw new Error(clientData.error.message || "Could not load customers.");
    if (profileData.error) throw new Error(profileData.error.message || "Could not load seller tax profile.");
    setRecords(Array.isArray(quotationData.records) ? quotationData.records : []);
    setClients(clientData.data?.records || []);
    setProfile(profileData.data?.records?.[0] || null);
  }, [account.workspace_id, request]);

  useEffect(() => { refresh().catch((loadError) => setError(loadError.message)); }, [refresh]);
  useEffect(() => {
    setTaxContext({
      countryCode, mode: "automatic", priceMode: "exclusive", taxMode: "taxable",
      taxTreatment: "standard", taxCategory: "standard-rated", taxDetailsConfirmed: false,
      placeOfSupply: "", destinationJurisdiction: { province: "" }, collectionObligationAttested: false,
    });
  }, [countryCode]);

  const workspaceProfile = useMemo(() => ({
    countryCode, currencyCode: currency,
    registrationNumber: profile?.tax_registration_number || "",
    registrationType: profile?.tax_registration_type || "",
    registrationStatus: profile?.tax_registration_status || "unregistered",
    registrationEffectiveFrom: profile?.tax_registration_effective_from || "",
    registeredJurisdiction: profile?.tax_jurisdiction_code || "",
  }), [countryCode, currency, profile]);
  const quoteAmountMinor = useMemo(() => form.items.reduce((sum, item) => {
    const quantity = Number(item.quantity);
    const unitPrice = minor(item.unit_price, currency);
    const discount = minor(item.discount, currency);
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isSafeInteger(unitPrice) || !Number.isSafeInteger(discount)) return NaN;
    return sum + Math.round(quantity * unitPrice) - discount;
  }, 0), [form.items, currency]);
  const taxPreviewInvoice = useMemo(() => ({
    currency, issueDate: form.issue_date,
    business: { name: profile?.legal_name || profile?.display_name || "", address: profile?.address || "" },
    items: Number.isSafeInteger(quoteAmountMinor) && quoteAmountMinor >= 0
      ? [{ quantity: 1, rate: quoteAmountMinor / (10 ** digits(currency)) }] : [],
    discountType: "fixed", discount: 0, globalTax: taxContext,
  }), [currency, form.issue_date, profile, quoteAmountMinor, taxContext]);
  const taxPreview = useMemo(
    () => calculateInvoiceGlobalTax(taxPreviewInvoice, workspaceProfile),
    [taxPreviewInvoice, workspaceProfile],
  );

  const selected = records.find((entry) => entry.quotation.id === selectedId) || null;
  const totals = useMemo(() => records.reduce((sum, entry) => ({
    all: sum.all + 1,
    open: sum.open + (["draft", "sent"].includes(entry.quotation.status) ? 1 : 0),
    accepted: sum.accepted + (entry.quotation.status === "accepted" ? 1 : 0),
    converted: sum.converted + (entry.quotation.status === "converted" ? 1 : 0),
  }), { all: 0, open: 0, accepted: 0, converted: 0 }), [records]);

  const updateItem = (index, key, value) => {
    setTaxContext((current) => ({ ...current, taxDetailsConfirmed: false }));
    setForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item),
    }));
  };
  const addItem = () => {
    setTaxContext((current) => ({ ...current, taxDetailsConfirmed: false }));
    setForm((current) => current.items.length >= 100 ? current : ({
      ...current, items: [...current.items, { description: "", quantity: "1", unit_price: "", discount: "0" }],
    }));
  };

  const createQuotation = async (event) => {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      if (form.valid_until && form.valid_until < form.issue_date) throw new Error("Validity date cannot be before the quotation date.");
      const items = form.items.map((item) => ({
        description: item.description.trim(),
        quantity: Number(item.quantity),
        unit_price_minor: minor(item.unit_price, currency),
        discount_minor: minor(item.discount, currency),
      }));
      if (items.some((item) => !item.description || !Number.isFinite(item.quantity) || item.quantity <= 0)) {
        throw new Error("Add a description and valid quantity for every line.");
      }
      const data = await request({
        action: "create", client_id: form.client_id || null, currency_code: currency,
        issue_date: form.issue_date, valid_until: form.valid_until || null,
        notes: form.notes.trim() || null, items, idempotency_key: newId(),
        tax_snapshot: taxPreview.ok === true && ["calculated", "not_applicable"].includes(taxPreview.status)
          ? { taxResult: taxPreview, taxContext }
          : null,
      });
      setShowCreate(false);
      setSelectedId(data.quotation?.id || "");
      setForm({ client_id: "", issue_date: today(), valid_until: "", notes: "", items: [{ description: "", quantity: "1", unit_price: "", discount: "0" }] });
      setNotice(taxPreview.ok === true && taxPreview.status === "calculated"
        ? "Quotation saved with a source-backed tax estimate. Review the PDF before sharing."
        : taxPreview.ok === true && taxPreview.status === "not_applicable"
          ? "Quotation saved with your explicit no-tax confirmation. This is not a zero-rated or exempt tax treatment."
          : "Quotation saved as a draft, but tax needs review. It cannot be marked as sent until tax is resolved.");
      await refresh();
    } catch (saveError) { setError(saveError.message || "Could not create quotation."); }
    finally { setBusy(false); }
  };

  const changeStatus = async (status) => {
    if (!selected) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await request({ action: "status", quotation_id: selected.quotation.id, status });
      setNotice(status === "sent" ? "Quotation marked as sent. Share the PDF with your customer yourself." : `Quotation marked as ${status}.`);
      await refresh();
    } catch (statusError) { setError(statusError.message || "Could not update quotation."); }
    finally { setBusy(false); }
  };

  const convertToInvoice = async () => {
    if (!selected) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await request({ action: "convert", quotation_id: selected.quotation.id });
      setNotice(`Converted to invoice draft ${result.invoice?.invoice_number || ""}. Review and issue it from Sales → Invoices.`);
      await refresh();
    } catch (convertError) { setError(convertError.message || "Could not convert quotation."); }
    finally { setBusy(false); }
  };

  const downloadPdf = (entry) => {
    try {
      const { quotation, client, items = [] } = entry;
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      doc.setFontSize(21); doc.setTextColor(91, 33, 182); doc.text("PLIVEX", 16, 20);
      doc.setFontSize(17); doc.setTextColor(20, 20, 20); doc.text("QUOTATION", 16, 32);
      doc.setFontSize(9); doc.setTextColor(90, 90, 90);
      doc.text(`Quotation: ${quotation.quotation_number}`, 16, 42);
      doc.text(`Date: ${quotation.issue_date}`, 16, 48);
      doc.text(`Valid until: ${quotation.valid_until || "Not specified"}`, 16, 54);
      doc.text(`Currency: ${quotation.currency_code}`, 16, 60);
      doc.setFontSize(11); doc.setTextColor(25, 25, 25);
      doc.text("Prepared for", 16, 74);
      doc.setFontSize(10); doc.text(String(client?.name || "Customer"), 16, 81);
      if (client?.email) doc.text(String(client.email), 16, 87);
      if (client?.phone) doc.text(String(client.phone), 16, 93);
      const drawHeader = (y) => {
        doc.setFillColor(246, 244, 251); doc.rect(16, y - 5, pageWidth - 32, 10, "F");
        doc.setFontSize(8); doc.setTextColor(75, 65, 90);
        doc.text("Description", 19, y + 1); doc.text("Qty", 116, y + 1, { align: "right" });
        doc.text("Unit price", 151, y + 1, { align: "right" }); doc.text("Amount", 190, y + 1, { align: "right" });
      };
      let y = 108; drawHeader(y); y += 12;
      doc.setFontSize(9); doc.setTextColor(35, 35, 35);
      for (const line of items) {
        const description = doc.splitTextToSize(String(line.description || ""), 82);
        const rowHeight = Math.max(8, description.length * 4.5);
        if (y + rowHeight > 265) { doc.addPage(); y = 20; drawHeader(y); y += 12; }
        doc.text(description, 19, y);
        doc.text(String(line.quantity), 116, y, { align: "right" });
        doc.text(formatMoney(line.unit_price_minor, quotation.currency_code, locale), 151, y, { align: "right" });
        doc.text(formatMoney(line.line_total_minor, quotation.currency_code, locale), 190, y, { align: "right" });
        y += rowHeight + 3;
      }
      y += 7;
      if (y > 260) { doc.addPage(); y = 24; }
      doc.setFontSize(10);
      doc.text("Subtotal: " + formatMoney(quotation.subtotal_minor, quotation.currency_code, locale), 16, y); y += 7;
      doc.text("Discount: " + formatMoney(quotation.discount_minor, quotation.currency_code, locale), 16, y); y += 8;
      doc.setFontSize(13); doc.setFont(undefined, "bold");
      doc.text((quotation.tax_status === "calculated" ? "Taxable amount: " : "Amount before tax: ") + formatMoney(quotation.taxable_minor ?? quotation.total_minor, quotation.currency_code, locale), 16, y);
      y += 8; doc.setFont(undefined, "normal"); doc.setFontSize(8); doc.setTextColor(100, 100, 100);
      const taxSnapshot = quotation.tax_snapshot;
      const taxResult = taxSnapshot?.taxResult;
      if (quotation.tax_status === "calculated" && taxResult?.status === "calculated") {
        for (const component of taxResult.components || []) {
          doc.text(String(component.name || "Tax") + " (" + Number(component.rateBps) / 100 + "%): " + formatMoney(component.amountMinor, quotation.currency_code, locale), 16, y); y += 6;
        }
        doc.text("Tax total: " + formatMoney(quotation.tax_minor, quotation.currency_code, locale), 16, y); y += 7;
        doc.setFontSize(13); doc.setFont(undefined, "bold");
        doc.text("Total including tax: " + formatMoney(quotation.total_minor, quotation.currency_code, locale), 16, y);
        y += 12; doc.setFont(undefined, "normal"); doc.setFontSize(8); doc.setTextColor(100, 100, 100);
        const note = "Quotation only — not a tax invoice. Tax is an estimate based on the selected, source-backed rule and business-confirmed transaction details. Recheck tax treatment before issuing the invoice.";
        doc.text(doc.splitTextToSize(note, pageWidth - 32), 16, Math.min(y, 280));
      } else {
        const note = "TAX REVIEW REQUIRED — tax has not been calculated. The displayed total excludes tax. Do not send this quotation as a final tax-inclusive price. Complete the verified tax calculation before marking it as sent.";
        doc.setTextColor(170, 70, 20);
        doc.text(doc.splitTextToSize(note, pageWidth - 32), 16, Math.min(y, 280));
      }
      if (quotation.notes) { y += 14; doc.setTextColor(40, 40, 40); doc.text(doc.splitTextToSize("Notes: " + quotation.notes, pageWidth - 32), 16, Math.min(y, 285)); }
      doc.save(`${quotation.quotation_number}.pdf`);
    } catch (pdfError) { setError(pdfError.message || "Could not create quotation PDF."); }
  };

  return (
    <section className="mt-5 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-violet-700">Sales workspace</p><h1 className="mt-1 text-2xl font-bold text-slate-900">Quotations</h1><p className="mt-1 text-sm text-slate-500">Prepare estimates, track customer decisions and convert accepted quotations into invoice drafts.</p></div>
        <button type="button" className={primary} onClick={() => { setError(""); setShowCreate(true); }}><Plus className="h-4 w-4" /> New quotation</button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Total", totals.all], ["Open", totals.open], ["Accepted", totals.accepted], ["Converted", totals.converted]].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold text-slate-900">{value}</p></div>
        ))}
      </div>

      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-3"><h2 className="font-bold text-slate-900">Quotation register</h2><p className="text-xs text-slate-500">Your latest quotations, scoped to this Global workspace.</p></div>
          {records.length === 0 ? <div className="p-10 text-center"><FileText className="mx-auto h-9 w-9 text-slate-300" /><p className="mt-3 text-sm font-semibold text-slate-700">No quotations yet</p><p className="mt-1 text-xs text-slate-500">Create your first estimate to get started.</p></div> : (
            <div className="divide-y divide-slate-100">
              {records.map((entry) => {
                const q = entry.quotation;
                return <button key={q.id} type="button" onClick={() => setSelectedId(q.id)} className={`flex w-full items-center justify-between gap-3 px-4 py-4 text-left transition hover:bg-violet-50/50 ${selectedId === q.id ? "bg-violet-50" : "bg-white"}`}>
                  <span className="min-w-0"><span className="block truncate text-sm font-bold text-slate-900">{q.quotation_number}</span><span className="mt-1 block truncate text-xs text-slate-500">{entry.client?.name || "No customer"} · {q.issue_date}</span></span>
                  <span className="shrink-0 text-right"><span className="block text-sm font-bold text-slate-900">{formatMoney(q.total_minor, q.currency_code, locale)}</span><span className={`mt-1 inline-flex rounded-full px-2 py-1 text-[10px] font-bold capitalize ${statusTone[q.status] || statusTone.draft}`}>{q.status}</span></span>
                </button>;
              })}
            </div>
          )}
        </div>

        <aside className="rounded-2xl border border-slate-200 bg-white p-4">
          {!selected ? <div className="flex min-h-48 flex-col items-center justify-center text-center"><FileText className="h-8 w-8 text-slate-300" /><p className="mt-3 text-sm font-semibold text-slate-700">Select a quotation</p><p className="mt-1 max-w-xs text-xs text-slate-500">Review details, download its PDF and manage its status here.</p></div> : <>
            <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-violet-700">Quotation details</p><h2 className="mt-1 break-all text-lg font-bold text-slate-900">{selected.quotation.quotation_number}</h2><p className="mt-1 text-xs text-slate-500">{selected.client?.name || "No customer"}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-bold capitalize ${statusTone[selected.quotation.status]}`}>{selected.quotation.status}</span></div>
            <div className="mt-4 space-y-2 border-y border-slate-100 py-3 text-sm">
              <div className="flex justify-between gap-3"><span className="text-slate-500">Date</span><span>{selected.quotation.issue_date}</span></div>
              <div className="flex justify-between gap-3"><span className="text-slate-500">Valid until</span><span>{selected.quotation.valid_until || "Not specified"}</span></div>
              <div className="flex justify-between gap-3"><span className="text-slate-500">Line items</span><span>{selected.items?.length || 0}</span></div>
              {selected.quotation.tax_status === "calculated" && <div className="flex justify-between gap-3"><span className="text-slate-500">Taxable amount</span><span>{formatMoney(selected.quotation.taxable_minor, selected.quotation.currency_code, locale)}</span></div>}
              {selected.quotation.tax_status === "calculated" && (selected.quotation.tax_snapshot?.taxResult?.components || []).map((component) => <div key={component.id} className="flex justify-between gap-3"><span className="text-slate-500">{component.name} ({Number(component.rateBps) / 100}%)</span><span>{formatMoney(component.amountMinor, selected.quotation.currency_code, locale)}</span></div>)}
              {selected.quotation.tax_status === "calculated" && <div className="flex justify-between gap-3"><span className="text-slate-500">Total tax</span><span>{formatMoney(selected.quotation.tax_minor, selected.quotation.currency_code, locale)}</span></div>}
              <div className="flex justify-between gap-3 font-bold"><span>Total {selected.quotation.tax_status === "calculated" ? "including tax" : "(tax review pending)"}</span><span>{formatMoney(selected.quotation.total_minor, selected.quotation.currency_code, locale)}</span></div>
            </div>
            {selected.quotation.notes && <p className="mt-3 text-xs leading-5 text-slate-600">{selected.quotation.notes}</p>}
            <button type="button" className={secondary + " mt-4 w-full"} onClick={() => downloadPdf(selected)}><Download className="h-4 w-4" /> Download PDF</button>
            {selected.quotation.!["calculated","not_applicable"].includes(selected.quotation.tax_status) && <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">Tax review required. This total excludes tax, and the server will not allow this quotation to be marked as sent.</p>}
            {selected.quotation.status === "draft" && <button type="button" className={primary + " mt-2 w-full"} disabled={busy || selected.quotation.tax_status !== "calculated"} onClick={() => changeStatus("sent")}><Send className="h-4 w-4" /> Mark as sent</button>}
            {["draft", "sent"].includes(selected.quotation.status) && <div className="mt-2 grid grid-cols-2 gap-2"><button type="button" className={secondary} disabled={busy} onClick={() => changeStatus("accepted")}><CheckCircle2 className="h-4 w-4" /> Accept</button><button type="button" className={secondary} disabled={busy} onClick={() => changeStatus("rejected")}><XCircle className="h-4 w-4" /> Reject</button></div>}
            {selected.quotation.status === "accepted" && <button type="button" className={primary + " mt-2 w-full"} disabled={busy} onClick={convertToInvoice}>Convert to invoice draft <ArrowRight className="h-4 w-4" /></button>}
            {selected.quotation.status === "converted" && <p className="mt-3 rounded-xl bg-violet-50 p-3 text-xs font-medium text-violet-800">Converted successfully. Open Sales → Invoices to review the invoice draft before issuing.</p>}
            <p className="mt-3 text-[11px] leading-5 text-slate-500">A quotation is not an invoice, does not create a receivable and cannot accept payments. Tax status: {selected.quotation.tax_status === "calculated" ? "source-backed estimate" : selected.quotation.tax_status === "not_applicable" ? "business-confirmed no tax" : "review required"}.</p>
          </>}
        </aside>
      </div>

      {showCreate && <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/40 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowCreate(false); }}>
        <form onSubmit={createQuotation} className="max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-7">
          <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-violet-700">New sales document</p><h2 className="mt-1 text-xl font-bold text-slate-900">Create quotation</h2><p className="mt-1 text-xs text-slate-500">Currency follows your verified Global workspace settings: {currency}.</p></div><button type="button" onClick={() => setShowCreate(false)} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100">Close</button></div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-semibold text-slate-600 sm:col-span-1">Customer<select className={field + " mt-1"} value={form.client_id} onChange={(event) => setForm({ ...form, client_id: event.target.value })}><option value="">Walk-in / not selected</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
            <label className="text-xs font-semibold text-slate-600">Quotation date<input required type="date" className={field + " mt-1"} value={form.issue_date} onChange={(event) => { setTaxContext((v) => ({ ...v, taxDetailsConfirmed: false })); setForm({ ...form, issue_date: event.target.value }); }} /></label>
            <label className="text-xs font-semibold text-slate-600">Valid until<input type="date" min={form.issue_date} className={field + " mt-1"} value={form.valid_until} onChange={(event) => setForm({ ...form, valid_until: event.target.value })} /></label>
          </div>
          <div className="mt-5"><div className="flex items-center justify-between"><h3 className="text-sm font-bold text-slate-900">Items and pricing</h3><span className="text-xs text-slate-500">{currency}</span></div>
            <div className="mt-2 space-y-3">{form.items.map((item, index) => <div key={index} className="grid gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-[minmax(0,2fr)_0.7fr_1fr_1fr_auto]">
              <input required aria-label="Description" className={field} placeholder="Description" value={item.description} onChange={(event) => updateItem(index, "description", event.target.value)} />
              <input required aria-label="Quantity" min="0.0001" step="0.0001" type="number" className={field} placeholder="Qty" value={item.quantity} onChange={(event) => updateItem(index, "quantity", event.target.value)} />
              <input required aria-label="Unit price" min="0" step="any" type="number" className={field} placeholder="Unit price" value={item.unit_price} onChange={(event) => updateItem(index, "unit_price", event.target.value)} />
              <input aria-label="Discount" min="0" step="any" type="number" className={field} placeholder="Discount" value={item.discount} onChange={(event) => updateItem(index, "discount", event.target.value)} />
              <button type="button" disabled={form.items.length === 1} onClick={() => { setTaxContext((v) => ({ ...v, taxDetailsConfirmed: false })); setForm((current) => ({ ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) })); }} className="min-h-10 rounded-lg px-3 text-xs font-semibold text-rose-600 disabled:opacity-30">Remove</button>
            </div>)}</div>
            <button type="button" disabled={form.items.length >= 100} className={secondary + " mt-3"} onClick={addItem}><Plus className="h-4 w-4" /> Add line item</button>
          </div>
          <section className="mt-5 rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-bold text-slate-900">Tax calculation</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">Uses the same country tax engine as invoices. Tax is calculated only when the current verified rule, seller registration and supply details are available.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-semibold text-slate-600">Place of supply
                {["GB","AE","AU","SG"].includes(countryCode) ? <select className={field + " mt-1"} value={taxContext.placeOfSupply} onChange={(e) => setTaxContext((v) => ({ ...v, placeOfSupply: e.target.value, taxDetailsConfirmed: false }))}><option value="">Select place</option>{countryCode === "GB" && <option value="United Kingdom">United Kingdom</option>}{countryCode === "AE" && <option value="United Arab Emirates">United Arab Emirates</option>}{countryCode === "AU" && <option value="Australia">Australia</option>}{countryCode === "SG" && <option value="Singapore">Singapore</option>}</select> : <input className={field + " mt-1"} value={taxContext.placeOfSupply} maxLength={180} placeholder="Supply destination / place" onChange={(e) => setTaxContext((v) => ({ ...v, placeOfSupply: e.target.value, taxDetailsConfirmed: false }))} />}
              </label>
              {countryCode === "CA" && <label className="text-xs font-semibold text-slate-600">Destination province / territory
                <select className={field + " mt-1"} value={taxContext.destinationJurisdiction.province} onChange={(e) => setTaxContext((v) => ({ ...v, destinationJurisdiction: { ...v.destinationJurisdiction, province: e.target.value }, taxDetailsConfirmed: false }))}>
                  <option value="">Select province / territory</option>
                  {["AB","BC","MB","NB","NL","NS","NT","NU","ON","PE","QC","SK","YT"].map((province) => <option key={province} value={province}>{province}</option>)}
                </select>
              </label>}
              {["BC","MB","SK"].includes(taxContext.destinationJurisdiction.province) && <label className="text-xs font-semibold text-slate-600 sm:col-span-2">Provincial sales tax classification
                <select className={field + " mt-1"} value={taxContext.taxCategory} onChange={(e) => setTaxContext((v) => ({ ...v, taxCategory: e.target.value, taxDetailsConfirmed: false }))}>
                  <option value="standard-rated">Not confirmed</option>
                  <option value={"CA_" + taxContext.destinationJurisdiction.province + "_PST_TAXABLE_GOODS"}>All lines are taxable tangible goods for this province's PST/RST</option>
                </select>
              </label>}
            </div>
            <label className="mt-3 flex items-start gap-2 text-xs leading-5 text-slate-600">
              <input type="checkbox" checked={taxContext.taxMode === "no_tax"} onChange={(e) => setTaxContext((v) => ({ ...v, taxMode: e.target.checked ? "no_tax" : "taxable", noTaxConfirmed: e.target.checked, taxDetailsConfirmed: false }))} />
              <span>I confirm no tax is chargeable on this transaction. This is a business attestation only; it is not the same as zero-rated or exempt treatment and is not independently verified by Plivex.</span>
            </label>
            {taxContext.taxMode !== "no_tax" && <label className="mt-3 flex items-start gap-2 text-xs leading-5 text-slate-600">
              <input type="checkbox" checked={taxContext.taxDetailsConfirmed === true} onChange={(e) => setTaxContext((v) => ({ ...v, taxDetailsConfirmed: e.target.checked, collectionObligationAttested: countryCode === "CA" ? e.target.checked : v.collectionObligationAttested }))} />
              <span>I confirm the seller's tax registration is current, the place of supply is correct, and all quotation lines have the selected standard tax treatment. For BC, Manitoba or Saskatchewan, I also confirm every line qualifies for the selected PST/RST taxable-goods category.</span>
            </label>}
            <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs">
              {taxPreview.ok === true && taxPreview.status === "calculated" ? <>
                <p className="font-semibold text-emerald-800">Tax calculated from the active rule</p>
                <p className="mt-1">Taxable: {formatMoney(taxPreview.taxableMinor, currency, locale)} · Tax: {formatMoney(taxPreview.taxMinor, currency, locale)} · Total: {formatMoney(taxPreview.totalMinor, currency, locale)}</p>
                {taxPreview.warning && <p className="mt-1 text-slate-500">{taxPreview.warning}</p>}
              </> : taxPreview.ok === true && taxPreview.status === "not_applicable" ? <>
                <p className="font-semibold text-emerald-800">No tax charged — business confirmed</p>
                <p className="mt-1">Total: {formatMoney(taxPreview.totalMinor, currency, locale)}</p>
              </> : <p className="text-amber-800">Tax review required: {taxPreview.message || "Complete seller registration and transaction details. Unsupported rates are not guessed."}</p>}
              <p className="mt-1 text-[11px] text-slate-500">Seller details are business-supplied. This estimate is not a tax invoice or independent legal verification.</p>
            </div>
          </section>
          <label className="mt-4 block text-xs font-semibold text-slate-600">Notes<textarea rows={3} maxLength={4000} className={field + " mt-1"} placeholder="Optional scope, delivery or payment terms" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">A quotation with unresolved tax remains a draft and cannot be marked as sent. Unsupported country rates are never guessed.</div>
          {error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" className={secondary} onClick={() => setShowCreate(false)}>Cancel</button><button type="submit" className={primary} disabled={busy}>{busy ? "Saving…" : "Save quotation draft"}</button></div>
        </form>
      </div>}
    </section>
  );
}
