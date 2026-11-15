import { useCallback, useEffect, useMemo, useState } from "react";
import { jsPDF } from "jspdf";
import { supabase } from "@/api/backendClient";
import GlobalTaxEditor from "@/components/invoice/GlobalTaxEditor";
import { calculateInvoiceGlobalTax } from "@/global/tax/invoice-tax-integration.js";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};
const digits = (currency) => {
  try { return new Intl.NumberFormat("en", { style:"currency", currency }).resolvedOptions().maximumFractionDigits; }
  catch { return 2; }
};
const minor = (amount, currency) => Math.round(Number(amount || 0) * (10 ** digits(currency)));
const money = (amount, currency) => new Intl.NumberFormat(undefined, { style:"currency", currency }).format(Number(amount || 0) / (10 ** digits(currency)));
const field = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm";
const button = "rounded-lg bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50";
const secondary = "rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50";
const newId = () => crypto.randomUUID();

export default function GlobalInvoicesPanel({ account, invoke, onRefresh }) {
  const currency = account?.currency_code || "USD";
  const countryCode = account?.country_code || "";
  const [clients, setClients] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [items, setItems] = useState([]);
  const [profile, setProfile] = useState(null);
  const [reconciliation, setReconciliation] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ clientId:"", issueDate:today(), dueDate:"", description:"", quantity:"1", unitPrice:"" });
  const [taxContext, setTaxContext] = useState({
    countryCode, mode:"automatic", priceMode:"exclusive", placeOfSupply:"",
    placeOfSupplyConfirmed:false, taxCategory:"standard-rated", taxCategoryConfirmed:true,
    registrationConfirmed:false, collectionObligationAttested:false, components:[],
  });
  const [profileForm, setProfileForm] = useState({});
  const [paymentForm, setPaymentForm] = useState({ amount:"", date:today(), method:"bank_transfer", reference:"" });
  const [refundForm, setRefundForm] = useState({ amount:"", date:today(), method:"bank_transfer", reference:"", reason:"" });

  const refresh = useCallback(async () => {
    const [clientData, invoiceData, itemData, profileData, reconciliationData] = await Promise.all([
      invoke("clients"), invoke("invoices"), invoke("invoice_items"), invoke("business_profiles"),
      supabase.functions.invoke("global-invoices", { body:{ action:"list_reconciliation", workspace_id:account.workspace_id, limit:100 } }),
    ]);
    setClients(clientData.records || []);
    setInvoices(invoiceData.records || []);
    setItems(itemData.records || []);
    const nextProfile = profileData.records?.[0] || null;
    setProfile(nextProfile);
    setProfileForm({
      legal_name: nextProfile?.legal_name || "",
      display_name: nextProfile?.display_name || "",
      email: nextProfile?.email || account.email || "",
      phone: nextProfile?.phone || "",
      address: nextProfile?.address || "",
      tax_registration_number: nextProfile?.tax_registration_number || "",
      tax_registration_type: nextProfile?.tax_registration_type || (countryCode === "GB" ? "VAT" : ""),
      tax_registration_status: nextProfile?.tax_registration_status || "unregistered",
      tax_registration_effective_from: nextProfile?.tax_registration_effective_from || "",
      tax_jurisdiction_code: nextProfile?.tax_jurisdiction_code || "",
    });
    setReconciliation(reconciliationData.data?.records || []);
    onRefresh?.();
  }, [account.email, account.workspace_id, countryCode, invoke, onRefresh]);

  useEffect(() => {
    setTaxContext({
      countryCode, mode:"automatic", priceMode:"exclusive", placeOfSupply:"",
      placeOfSupplyConfirmed:false, taxCategory:"standard-rated", taxCategoryConfirmed:false,
      registrationConfirmed:false, collectionObligationAttested:false, components:[],
    });
  }, [countryCode, selectedId]);

  useEffect(() => { refresh().catch((e) => setError(e.message || "Could not load Global invoices.")); }, [refresh]);

  const selected = invoices.find((invoice) => invoice.id === selectedId) || null;
  const selectedItems = useMemo(() => items.filter((item) => item.invoice_id === selectedId).sort((a,b) => a.sort_order-b.sort_order), [items, selectedId]);
  const workspaceProfile = useMemo(() => ({
    countryCode, currencyCode:currency,
    registrationNumber:profile?.tax_registration_number || "",
    registrationType:profile?.tax_registration_type || "",
    registrationStatus:profile?.tax_registration_status || "unregistered",
    registrationEffectiveFrom:profile?.tax_registration_effective_from || "",
    registeredJurisdiction:profile?.tax_jurisdiction_code || "",
  }), [countryCode, currency, profile]);
  const previewInvoice = useMemo(() => ({
    currency, issueDate:selected?.issue_date || form.issueDate,
    business:{ name:profile?.legal_name || profile?.display_name || "", address:profile?.address || "" },
    items:selectedItems.map((item) => ({ quantity:Number(item.quantity), rate:Number(item.unit_price_minor || 0) / (10 ** digits(currency)) })),
    discountType:"fixed", discount:Number(selected?.discount_minor || 0) / (10 ** digits(currency)), globalTax:taxContext,
  }), [currency, form.issueDate, profile, selected, selectedItems, taxContext]);
  const taxPreview = useMemo(() => calculateInvoiceGlobalTax(previewInvoice, workspaceProfile), [previewInvoice, workspaceProfile]);

  const saveProfile = async (event) => {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("global-business-records", {
        body:{ workspace_id:account.workspace_id, table:"business_profiles", action:"update", id:account.workspace_id, values:profileForm },
      });
      if (invokeError) throw invokeError;
      if (!data?.ok) throw new Error(data?.error || "Could not save seller profile.");
      setNotice("Seller and tax registration profile saved. Registration details are business-supplied and not independently verified.");
      await refresh();
    } catch (e) { setError(e.message || "Could not save seller profile."); }
    finally { setBusy(false); }
  };

  const createDraft = async (event) => {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("global-invoices", {
        body:{
          action:"create_draft", workspace_id:account.workspace_id,
          client_id:form.clientId || null, currency_code:currency,
          issue_date:form.issueDate, due_date:form.dueDate || null,
          notes:null, idempotency_key:newId(),
          items:[{
            description:form.description.trim(), quantity:Number(form.quantity),
            unit_price_minor:minor(form.unitPrice,currency), discount_minor:0, product_id:null,
          }],
        },
      });
      if (invokeError) throw invokeError;
      if (!data?.ok) throw new Error(data?.error || "Could not create draft invoice.");
      setSelectedId(data.invoice.id);
      setShowCreate(false);
      setNotice("Draft saved. It is not an issued invoice and cannot yet be used to request payment.");
      await refresh();
    } catch (e) { setError(e.message || "Could not create draft invoice."); }
    finally { setBusy(false); }
  };

  const issueInvoice = async () => {
    if (!selected || selected.status !== "draft") return;
    setBusy(true); setError(""); setNotice("");
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("global-invoices", {
        body:{
          action:"issue", workspace_id:account.workspace_id, invoice_id:selected.id,
          idempotency_key:newId(),
          tax_context:{
            registration_confirmed:taxContext.registrationConfirmed === true,
            place_of_supply_confirmed:taxContext.placeOfSupplyConfirmed === true,
            tax_category_confirmed:taxContext.taxCategoryConfirmed === true,
            tax_category:taxContext.taxCategory || "",
            mode:taxContext.mode || "",
            price_mode:taxContext.priceMode || "",
            place_of_supply:taxContext.placeOfSupply || "",
          },
        },
      });
      if (invokeError) throw invokeError;
      if (!data?.ok) throw new Error(data?.error || "Could not issue invoice.");
      setNotice("Invoice issued with a server-generated number and locked tax snapshot.");
      await refresh();
    } catch (e) { setError(e.message || "Could not issue invoice."); }
    finally { setBusy(false); }
  };

  const downloadPdf = async (invoice) => {
    try {
      const lineItems = items.filter((item) => item.invoice_id === invoice.id).sort((a,b) => a.sort_order-b.sort_order);
      const doc = new jsPDF();
      const snap = invoice.invoice_snapshot || {};
      const seller = snap.seller || {};
      const buyer = snap.buyer || {};
      doc.setFontSize(20); doc.text("PLIVEX · TAX INVOICE", 16, 20);
      doc.setFontSize(10);
      doc.text(`Invoice: ${invoice.invoice_number}`,16,31);
      doc.text(`Issue date: ${invoice.issue_date}`,16,37);
      doc.text(`Due date: ${invoice.due_date || "—"}`,16,43);
      doc.text(`Seller: ${seller.legal_name || profile?.legal_name || "—"}`,16,55);
      doc.text(`Address: ${seller.address || profile?.address || "—"}`,16,61);
      doc.text(`VAT number: ${seller.tax_registration_number || "—"}`,16,67);
      const client=clients.find((c)=>c.id===invoice.client_id);
      doc.text(`Bill to: ${buyer.name || client?.name || "Customer"}`,16,80);
      if (buyer.email || client?.email) doc.text(`Customer email: ${buyer.email || client?.email}`,16,86);
      doc.text("Description",16,96); doc.text("Qty",110,96); doc.text("Net",130,96); doc.text("VAT",160,96); doc.text("Total",190,96,{align:"right"});
      let y=104;
      for (const line of lineItems) {
        if (y>260) { doc.addPage(); y=20; }
        doc.text(String(line.description || "").slice(0,48),16,y);
        doc.text(String(line.quantity),110,y);
        doc.text(money(line.line_total_minor-(line.tax_minor||0),invoice.currency_code),130,y);
        doc.text(money(line.tax_minor||0,invoice.currency_code),160,y);
        doc.text(money(line.line_total_minor,invoice.currency_code),190,y,{align:"right"});
        y+=8;
      }
      y+=10;
      doc.text(`Subtotal: ${money(invoice.subtotal_minor,invoice.currency_code)}`,16,y); y+=7;
      doc.text(`Discount: ${money(invoice.discount_minor,invoice.currency_code)}`,16,y); y+=7;
      doc.text(`VAT: ${money(invoice.tax_minor,invoice.currency_code)}`,16,y); y+=7;
      doc.setFontSize(13); doc.text(`Total: ${money(invoice.total_minor,invoice.currency_code)}`,16,y);
      doc.setFontSize(8); doc.text("Tax treatment and registration information are based on seller-provided declarations.",16,285);
      doc.save(`${invoice.invoice_number}.pdf`);
    } catch (e) { setError(e.message || "Could not create invoice PDF."); }
  };

  const shareInvoice = (invoice, channel) => {
    const client=clients.find((c)=>c.id===invoice.client_id);
    const message=`Invoice ${invoice.invoice_number} · ${money(invoice.total_minor,invoice.currency_code)} · Status: ${invoice.status}. Download the PDF from Plivex and attach it before sending.`;
    if (channel === "whatsapp") window.open("https://wa.me/?text="+encodeURIComponent(message),"_blank","noopener,noreferrer");
    else window.location.href="mailto:"+(client?.email || "")+"?subject="+encodeURIComponent("Invoice "+invoice.invoice_number)+"&body="+encodeURIComponent(message);
  };

  const recordPayment = async (event) => {
    event.preventDefault(); if (!selected) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("global-invoices", {
        body:{ action:"record_payment",workspace_id:account.workspace_id,invoice_id:selected.id,
          amount_minor:minor(paymentForm.amount,currency),currency_code:currency,payment_date:paymentForm.date,
          method:paymentForm.method,reference:paymentForm.reference,idempotency_key:newId() },
      });
      if (invokeError) throw invokeError;
      if (!data?.ok) throw new Error(data?.error || "Could not record payment.");
      setNotice("Payment entry recorded in the Global invoice ledger.");
      setPaymentForm({ amount:"",date:today(),method:"bank_transfer",reference:"" });
      await refresh();
    } catch (e) { setError(e.message || "Could not record payment."); }
    finally { setBusy(false); }
  };

  const recordRefund = async (event) => {
    event.preventDefault(); if (!selected) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("global-invoices", {
        body:{ action:"record_refund",workspace_id:account.workspace_id,invoice_id:selected.id,
          amount_minor:minor(refundForm.amount,currency),currency_code:currency,refund_date:refundForm.date,
          method:refundForm.method,reference:refundForm.reference,reason:refundForm.reason,idempotency_key:newId() },
      });
      if (invokeError) throw invokeError;
      if (!data?.ok) throw new Error(data?.error || "Could not record refund.");
      setNotice("Refund entry recorded. This is an accounting ledger entry; it does not trigger a payment-provider refund.");
      setRefundForm({ amount:"",date:today(),method:"bank_transfer",reference:"",reason:"" });
      await refresh();
    } catch (e) { setError(e.message || "Could not record refund."); }
    finally { setBusy(false); }
  };

  const selectedClient = clients.find((client) => client.id === selected?.client_id);
  const canIssue = countryCode === "GB" && selected?.status === "draft" && taxPreview.ok === true;

  return (
    <section className="mt-6 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-bold">Global invoices</h1><p className="mt-1 text-sm text-slate-500">Draft, issue and reconcile invoices in {currency}. Issuance is currently enabled for UK standard-rated VAT only.</p></div>
        <button className={button} onClick={() => { setShowCreate((v)=>!v); setError(""); setNotice(""); }}> {showCreate ? "Close" : "Create draft"} </button>
      </div>
      {notice && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <details className="rounded-xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer font-semibold">Seller & tax registration profile</summary>
        <form onSubmit={saveProfile} className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            ["legal_name","Legal business name"],["display_name","Display name"],["email","Business email"],
            ["phone","Phone"],["address","Registered business address"],["tax_registration_number","Tax registration number"],
            ["tax_registration_type","Registration type (e.g. VAT)"],["tax_registration_effective_from","Registration effective date"],
            ["tax_jurisdiction_code","Registered jurisdiction code"],
          ].map(([key,label])=><label key={key} className="text-xs font-semibold text-slate-600">{label}<input className={field+" mt-1"} type={key==="tax_registration_effective_from"?"date":"text"} value={profileForm[key]||""} onChange={(e)=>setProfileForm((v)=>({...v,[key]:e.target.value}))}/></label>)}
          <label className="text-xs font-semibold text-slate-600">Registration status
            <select className={field+" mt-1"} value={profileForm.tax_registration_status||"unregistered"} onChange={(e)=>setProfileForm((v)=>({...v,tax_registration_status:e.target.value}))}>
              {["unregistered","pending","registered","deregistered"].map((x)=><option key={x}>{x}</option>)}
            </select>
          </label>
          <div className="sm:col-span-2"><button disabled={busy} className={button}>Save seller profile</button><p className="mt-2 text-xs text-slate-500">Plivex stores seller-entered details; it does not independently verify tax registration or determine legal obligations.</p></div>
        </form>
      </details>

      {showCreate && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">New draft invoice</h2>
          <form onSubmit={createDraft} className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-600">Customer<select className={field+" mt-1"} value={form.clientId} onChange={(e)=>setForm((v)=>({...v,clientId:e.target.value}))}><option value="">No customer selected</option>{clients.map((c)=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label className="text-xs font-semibold text-slate-600">Issue date<input required type="date" className={field+" mt-1"} value={form.issueDate} onChange={(e)=>setForm((v)=>({...v,issueDate:e.target.value}))}/></label>
            <label className="text-xs font-semibold text-slate-600">Due date<input type="date" className={field+" mt-1"} value={form.dueDate} onChange={(e)=>setForm((v)=>({...v,dueDate:e.target.value}))}/></label>
            <label className="text-xs font-semibold text-slate-600">Description<input required maxLength={500} className={field+" mt-1"} value={form.description} onChange={(e)=>setForm((v)=>({...v,description:e.target.value}))}/></label>
            <label className="text-xs font-semibold text-slate-600">Quantity<input required min="0.0001" step="0.0001" type="number" className={field+" mt-1"} value={form.quantity} onChange={(e)=>setForm((v)=>({...v,quantity:e.target.value}))}/></label>
            <label className="text-xs font-semibold text-slate-600">Unit price ({currency})<input required min="0" step="0.01" type="number" className={field+" mt-1"} value={form.unitPrice} onChange={(e)=>setForm((v)=>({...v,unitPrice:e.target.value}))}/></label>
            <div className="sm:col-span-2 flex items-center justify-between gap-3"><span className="text-sm text-slate-500">Draft amount: {money(minor(Number(form.quantity||0)*Number(form.unitPrice||0),currency),currency)}</span><button disabled={busy} className={button}>Save draft</button></div>
          </form>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-3 font-semibold">Invoices</div>
          {invoices.length===0 ? <p className="p-8 text-center text-sm text-slate-500">No Global invoices yet.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-3">Invoice</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Total</th></tr></thead><tbody className="divide-y divide-slate-100">{invoices.map((invoice)=><tr key={invoice.id} className={selectedId===invoice.id?"bg-violet-50":""}><td className="px-3 py-3"><button className="font-semibold text-violet-700" onClick={()=>setSelectedId(invoice.id)}>{invoice.invoice_number}</button><div className="text-xs text-slate-500">{invoice.issue_date}</div></td><td className="px-3 py-3">{invoice.status}</td><td className="px-3 py-3">{money(invoice.total_minor,invoice.currency_code)}</td></tr>)}</tbody></table></div>}
        </div>
        <div className="space-y-4">
          {selected ? <>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="font-semibold">{selected.invoice_number}</h2>
              <p className="mt-1 text-sm text-slate-500">{selectedClient?.name || "Customer"} · {selected.status}</p>
              <div className="mt-3 space-y-1 text-sm"><p>Subtotal: {money(selected.subtotal_minor,currency)}</p><p>Discount: {money(selected.discount_minor,currency)}</p><p>Tax: {money(selected.tax_minor,currency)}</p><p className="font-bold">Total: {money(selected.total_minor,currency)}</p></div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button className={secondary} onClick={()=>downloadPdf(selected)}>Download PDF</button>
                <button className={secondary} onClick={()=>shareInvoice(selected,"whatsapp")}>WhatsApp</button>
                <button className={secondary} onClick={()=>shareInvoice(selected,"email")}>Email</button>
              </div>
              {selected.status==="draft" && countryCode==="GB" && <>
                <div className="mt-4"><GlobalTaxEditor invoice={previewInvoice} setInvoice={(updater)=>setTaxContext((old)=>typeof updater==="function"?updater({globalTax:old}).globalTax:updater.globalTax)} workspaceProfile={workspaceProfile}/></div>
                <button className={button+" mt-3 w-full"} disabled={busy||!canIssue} onClick={issueInvoice}>Issue UK VAT invoice</button>
                {!canIssue && <p className="mt-2 text-xs text-amber-700">Complete the registered GB VAT seller profile before issuing. Other countries remain draft-only in this release.</p>}
              </>}
              {selected.status!=="draft" && <p className="mt-3 text-xs text-slate-500">Issued invoice content and tax snapshot are locked. Payments and refunds are recorded separately.</p>}
            </div>
            {["issued","partially_paid","overdue"].includes(selected.status) && (
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="font-semibold">Record payment</h3>
                <form className="mt-3 grid gap-2" onSubmit={recordPayment}>
                  <input required min="0.01" step="0.01" type="number" className={field} placeholder={`Amount (${currency})`} value={paymentForm.amount} onChange={(e)=>setPaymentForm((v)=>({...v,amount:e.target.value}))}/>
                  <input required type="date" className={field} value={paymentForm.date} onChange={(e)=>setPaymentForm((v)=>({...v,date:e.target.value}))}/>
                  <input className={field} placeholder="Method" value={paymentForm.method} onChange={(e)=>setPaymentForm((v)=>({...v,method:e.target.value}))}/>
                  <input className={field} placeholder="Reference" value={paymentForm.reference} onChange={(e)=>setPaymentForm((v)=>({...v,reference:e.target.value}))}/>
                  <button disabled={busy} className={button}>Add payment entry</button>
                </form>
              </div>
            )}
            {selected.amount_paid_minor>selected.amount_refunded_minor && (
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="font-semibold">Record refund</h3>
                <form className="mt-3 grid gap-2" onSubmit={recordRefund}>
                  <input required min="0.01" step="0.01" type="number" className={field} placeholder={`Amount (${currency})`} value={refundForm.amount} onChange={(e)=>setRefundForm((v)=>({...v,amount:e.target.value}))}/>
                  <input required type="date" className={field} value={refundForm.date} onChange={(e)=>setRefundForm((v)=>({...v,date:e.target.value}))}/>
                  <input className={field} placeholder="Method" value={refundForm.method} onChange={(e)=>setRefundForm((v)=>({...v,method:e.target.value}))}/>
                  <input className={field} placeholder="Reference" value={refundForm.reference} onChange={(e)=>setRefundForm((v)=>({...v,reference:e.target.value}))}/>
                  <input className={field} placeholder="Reason" value={refundForm.reason} onChange={(e)=>setRefundForm((v)=>({...v,reason:e.target.value}))}/>
                  <button disabled={busy} className={button}>Add refund ledger entry</button>
                  <p className="text-xs text-amber-700">This records a refund in Plivex only; it does not move money or call a payment provider.</p>
                </form>
              </div>
            )}
          </> : <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">Select an invoice to view, issue or reconcile it.</div>}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="font-semibold">Payment reconciliation</div>
        <p className="mt-1 text-xs text-slate-500">Gross payments less recorded refunds. This is an internal ledger view, not a bank statement.</p>
        <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="p-2">Invoice</th><th className="p-2">Gross paid</th><th className="p-2">Refunds</th><th className="p-2">Net received</th><th className="p-2">Outstanding</th></tr></thead><tbody className="divide-y divide-slate-100">{reconciliation.map((row)=><tr key={row.invoice_id}><td className="p-2">{row.invoice_number}</td><td className="p-2">{money(row.gross_payments_minor,row.currency_code)}</td><td className="p-2">{money(row.refunds_minor,row.currency_code)}</td><td className="p-2">{money(row.net_received_minor,row.currency_code)}</td><td className="p-2">{money(row.outstanding_minor,row.currency_code)}</td></tr>)}</tbody></table></div>
      </div>
    </section>
  );
}
