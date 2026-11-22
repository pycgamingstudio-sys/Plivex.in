import { useCallback, useEffect, useMemo, useState } from "react";
import { jsPDF } from "jspdf";
import { supabase } from "@/api/backendClient";
import GlobalTaxEditor from "@/components/invoice/GlobalTaxEditor";
import { calculateInvoiceGlobalTax } from "@/global/tax/invoice-tax-integration.js";
import { getCountryExperience } from "@/global/countries/country-experience.js";
import { formatWorkspaceDate } from "@/global/localization/date-format.js";
import { resolveGlobalInvoiceContext, canIssueCommercialInvoice, getGlobalInvoiceDocumentTitle, getGlobalInvoiceTaxDisclosure } from "@/global/invoices/invoice-readiness.js";
import { normalizeGlobalInvoiceSnapshot, getGlobalInvoicePdfFilename } from "@/global/invoices/pdf-download.js";
import { normalizeIndiaCompliance, buildIndiaComplianceDetailsExport } from "@/global/tax/india-compliance.js";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};
const digits = (currency) => {
  try { return new Intl.NumberFormat("en", { style:"currency", currency }).resolvedOptions().maximumFractionDigits; }
  catch { return 2; }
};
const minor = (amount, currency) => Math.round(Number(amount || 0) * (10 ** digits(currency)));
const CURRENCY_LOCALES = Object.freeze({ INR:"en-IN", USD:"en-US", GBP:"en-GB", AED:"en-AE", CAD:"en-CA", AUD:"en-AU", SGD:"en-SG" });
const money = (amount, currency) => {
  const locale = CURRENCY_LOCALES[currency] || "en";
  return new Intl.NumberFormat(locale, { style:"currency", currency }).format(Number(amount || 0) / (10 ** digits(currency)));
};
const field = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm";
const button = "rounded-lg bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50";
const secondary = "rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50";
const newId = () => crypto.randomUUID();

export default function GlobalInvoicesPanel({ account, invoke, onRefresh }) {
  const workspaceContext = resolveGlobalInvoiceContext(account);
  const currency = workspaceContext.ok ? workspaceContext.currencyCode : "";
  const countryCode = workspaceContext.countryCode || String(account?.country_code || "").trim().toUpperCase();
  const money = (amount, currencyCode = currency) => new Intl.NumberFormat(
    CURRENCY_LOCALES[currencyCode] || account?.locale_code || "en",
    { style:"currency", currency:currencyCode || "USD" },
  ).format(Number(amount || 0) / (10 ** digits(currencyCode || "USD")));
  const [clients, setClients] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [items, setItems] = useState([]);
  const [profile, setProfile] = useState(null);
  const [reconciliation, setReconciliation] = useState([]);
  const [backendCapabilities, setBackendCapabilities] = useState({ issuanceReady:false, commercialIssuanceReady:false, ledgerReady:false });
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ clientId:"", issueDate:today(), dueDate:"", description:"", quantity:"1", unitPrice:"", documentType:"commercial" });
  const [taxContext, setTaxContext] = useState({
    countryCode, mode:"automatic", priceMode:"exclusive", taxCode:"GST_18", indiaSupplyType:"INTRA", placeOfSupply:"",
    placeOfSupplyConfirmed:false, taxCategory:"standard-rated", taxCategoryConfirmed:true,
    registrationConfirmed:false, taxDetailsConfirmed:false, collectionObligationAttested:false, components:[],
  });
  const [profileForm, setProfileForm] = useState({});
  const [paymentForm, setPaymentForm] = useState({ amount:"", date:today(), method:"bank_transfer", reference:"" });
  const [refundForm, setRefundForm] = useState({ amount:"", date:today(), method:"bank_transfer", reference:"", reason:"" });
  const [activeShare, setActiveShare] = useState(null);
  const [indiaComplianceForm, setIndiaComplianceForm] = useState({
    irn:"", ack_number:"", ack_date:"", eway_bill_number:"", eway_bill_date:"", eway_bill_valid_until:"",
    transport_mode:"road", vehicle_number:"", transporter_id:"", transporter_name:"", distance_km:"",
  });

  const refresh = useCallback(async () => {
    const capabilityResult = await supabase.functions.invoke("global-invoices", {
      body:{ action:"capabilities", workspace_id:account.workspace_id },
    });
    const capabilities = {
      issuanceReady: capabilityResult.data?.ok === true && capabilityResult.data?.issuance_ready === true,
      commercialIssuanceReady: capabilityResult.data?.ok === true && capabilityResult.data?.commercial_issuance_ready === true,
      ledgerReady: capabilityResult.data?.ok === true && capabilityResult.data?.ledger_ready === true,
    };
    setBackendCapabilities(capabilities);
    const [clientData, invoiceData, itemData, profileData, reconciliationData] = await Promise.all([
      invoke("clients"), invoke("invoices"), invoke("invoice_items"), invoke("business_profiles"),
      capabilities.ledgerReady
        ? supabase.functions.invoke("global-invoices", { body:{ action:"list_reconciliation", workspace_id:account.workspace_id, limit:100 } })
        : Promise.resolve({ data:{ records:[] }, error:null }),
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
      countryCode, mode:"automatic", priceMode:"exclusive", taxCode:"GST_18", indiaSupplyType:"INTRA", placeOfSupply:"",
      placeOfSupplyConfirmed:false, taxCategory:"standard-rated", taxCategoryConfirmed:false,
      registrationConfirmed:false, taxDetailsConfirmed:false, collectionObligationAttested:false, components:[],
    });
  }, [countryCode, selectedId]);

  useEffect(() => { refresh().catch((e) => setError(e.message || "Could not load Global invoices.")); }, [refresh]);

  const selected = invoices.find((invoice) => invoice.id === selectedId) || null;
  useEffect(() => {
    const saved = selected?.invoice_snapshot?.india_compliance || {};
    setIndiaComplianceForm({
      irn:saved.irn || "", ack_number:saved.ack_number || "", ack_date:saved.ack_date || "",
      eway_bill_number:saved.eway_bill_number || "", eway_bill_date:saved.eway_bill_date || "",
      eway_bill_valid_until:saved.eway_bill_valid_until || "", transport_mode:saved.transport_mode || "road",
      vehicle_number:saved.vehicle_number || "", transporter_id:saved.transporter_id || "",
      transporter_name:saved.transporter_name || "", distance_km:saved.distance_km ?? "",
    });
  }, [selectedId, selected?.invoice_snapshot?.india_compliance]);
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
  const createPreviewInvoice = useMemo(() => ({
    currency, issueDate:form.issueDate,
    business:{ name:profile?.legal_name || profile?.display_name || "", address:profile?.address || "" },
    items:form.description.trim() ? [{ quantity:Number(form.quantity), rate:Number(form.unitPrice) }] : [],
    discountType:"fixed", discount:0, globalTax:taxContext,
  }), [currency, form.description, form.issueDate, form.quantity, form.unitPrice, profile, taxContext]);
  const createTaxPreview = useMemo(() => calculateInvoiceGlobalTax(createPreviewInvoice, workspaceProfile), [createPreviewInvoice, workspaceProfile]);

  const saveProfile = async (event) => {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const profileValues = { ...profileForm, tax_registration_effective_from: profileForm.tax_registration_effective_from || null };
      const { data, error: invokeError } = await supabase.functions.invoke("global-business-records", {
        body:{ workspace_id:account.workspace_id, table:"business_profiles", action:"update", id:account.workspace_id, values:profileValues },
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
      if (!workspaceContext.ok) throw new Error("Your workspace country and base currency could not be verified. No fallback currency has been applied.");
      const isTaxInvoice = taxContext.taxMode !== "no_tax";
      if (!sellerProfileReady) throw new Error("Complete the seller legal name and business address before issuing an invoice.");
      if (isTaxInvoice && taxContext.taxDetailsConfirmed !== true && taxContext.registrationConfirmed !== true) {
        throw new Error("Confirm the saved registration, place of supply and tax category before saving this tax calculation.");
      }
      if (taxContext.taxMode === "no_tax" && taxContext.noTaxConfirmed !== true) {
        throw new Error("Confirm the no-tax commercial invoice choice before saving.");
      }
      const { data, error: invokeError } = await supabase.functions.invoke("global-invoices", {
        body:{
          action:"create_draft",
          workspace_id:account.workspace_id,
          client_id:form.clientId || null, currency_code:currency,
          issue_date:form.issueDate, due_date:form.dueDate || null,
          notes:null, idempotency_key:newId(),
          items:[{
            description:form.description.trim(), quantity:Number(form.quantity),
            unit_price_minor:minor(form.unitPrice,currency), discount_minor:0, product_id:null,
          }],
          tax_context:{
            tax_mode:taxContext.taxMode || "taxable",
            no_tax_confirmed:taxContext.noTaxConfirmed === true,
            registration_confirmed:taxContext.registrationConfirmed === true,
            place_of_supply_confirmed:taxContext.placeOfSupplyConfirmed === true,
            tax_category_confirmed:taxContext.taxCategoryConfirmed === true,
            tax_category:taxContext.taxCategory || "",
            tax_treatment:taxContext.taxTreatment || "standard",
            tax_code:taxContext.taxCode || null,
            india_supply_type:taxContext.indiaSupplyType || "INTRA",
            mode:taxContext.mode || "automatic",
            price_mode:taxContext.priceMode || "exclusive",
            place_of_supply:taxContext.placeOfSupply || "",
            destination_jurisdiction:taxContext.destinationJurisdiction || {},
            collection_obligation_attested:taxContext.collectionObligationAttested === true,
          },
        },
      });
      if (invokeError) throw invokeError;
      if (!data?.ok || data?.invoice?.status !== "draft" || !data?.invoice?.id) {
        throw new Error(data?.error || "The server did not confirm the invoice draft and tax snapshot.");
      }
      setSelectedId(data.invoice.id);
      setShowCreate(false);
      setNotice("Invoice draft saved using the Workspace country tax rule. Review the tax snapshot and complete the appropriate issuance checks before issuing.");
      await refresh();
      await downloadPdf(data.invoice);
    } catch (e) { setError(e.message || "Could not create the final invoice."); }
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


  const issueCommercialInvoice = async () => {
    if (!selected || selected.status !== "draft" || !workspaceContext.ok) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("global-invoices", {
        body:{ action:"issue_commercial", workspace_id:account.workspace_id, invoice_id:selected.id, idempotency_key:newId() },
      });
      if (invokeError) throw invokeError;
      if (!data?.ok || !data?.invoice?.invoice_number) throw new Error(data?.error || "Could not issue the commercial invoice.");
      setNotice("Commercial invoice " + data.invoice.invoice_number + " issued. Tax has not been calculated or validated by Plivex.");
      await refresh();
    } catch (e) { setError(e.message || "Could not issue the commercial invoice."); }
    finally { setBusy(false); }
  };

  const saveIndiaCompliance = async () => {
    if (!selected || countryCode !== "IN") return;
    const normalized = normalizeIndiaCompliance(indiaComplianceForm);
    if (!normalized.ok) { setError(normalized.error); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("global-invoices", {
        body:{
          action:"save_india_compliance", workspace_id:account.workspace_id,
          invoice_id:selected.id, compliance:normalized.value,
        },
      });
      if (invokeError) throw invokeError;
      if (!data?.ok) throw new Error(data?.error || "Could not save manual IRN / E-Way Bill references.");
      setNotice("Manual IRN and E-Way Bill references saved to the issued invoice audit trail.");
      await refresh();
    } catch (e) { setError(e.message || "Could not save invoice compliance references."); }
    finally { setBusy(false); }
  };

  const downloadIndiaDetails = (exportType) => {
    if (!selected || countryCode !== "IN") return;
    const normalized = normalizeIndiaCompliance(indiaComplianceForm);
    if (!normalized.ok) { setError(normalized.error); return; }
    try {
      const snapshot = normalizeGlobalInvoiceSnapshot(selected.invoice_snapshot);
      const payload = buildIndiaComplianceDetailsExport({
        invoice:selected, items:selectedItems,
        seller:profile || snapshot.business || {},
        buyer:selectedClient || snapshot.client || snapshot.buyer || {},
        compliance:normalized.value,
        exportType,
      });
      const blob = new Blob([JSON.stringify(payload,null,2)], { type:"application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const safeNumber = String(selected.invoice_number || "invoice").replace(/[^a-z0-9_-]/gi,"-").slice(0,80);
      link.download = "Plivex-" + exportType + "-" + safeNumber + ".json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice((exportType === "e_invoice" ? "E-Invoice" : "E-Way Bill") + " details JSON exported for manual portal entry. This is not a government API payload.");
    } catch (e) { setError(e.message || "Could not export India compliance details."); }
  };

  const downloadPdf = async (invoice) => {
    if (!invoice?.id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(invoice.id)) {
      setError("Select a saved Global invoice before downloading its PDF. If this invoice was just created, refresh the invoice list and select it again.");
      return;
    }
    setError("");
    try {
      const lineItems = (Array.isArray(items) ? items : [])
        .filter((item) => item?.invoice_id === invoice.id)
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
      const snap = normalizeGlobalInvoiceSnapshot(invoice.invoice_snapshot);
      const invoiceCurrency = String(invoice.currency_code || snap.currency_code || currency || "").trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(invoiceCurrency)) throw new Error("This invoice has no valid saved currency snapshot.");
      // Validate the ISO currency before any PDF text is formatted.
      new Intl.NumberFormat("en", { style: "currency", currency: invoiceCurrency });
      const invoiceCountry = String(snap.country_code || countryCode || "").trim().toUpperCase();
      const experience = getCountryExperience(invoiceCountry);
      const locale = typeof snap.locale_code === "string" && snap.locale_code
        ? snap.locale_code
        : CURRENCY_LOCALES[invoiceCurrency] || account?.locale_code || "en";
      const requiresWorkspaceZone = experience?.timeZonePolicy === "workspace-select";
      const timeZone = account?.time_zone || (requiresWorkspaceZone ? "UTC" : experience?.timeZonePolicy || "UTC");
      const dateLabel = (value) => {
        if (!value) return "—";
        try { return formatWorkspaceDate(value, { locale, timeZone }) + (requiresWorkspaceZone && !account?.time_zone ? " (UTC)" : ""); }
        catch { return String(value); }
      };
      const registrationLabel = experience?.business.registrationLabel || "Tax registration";
      const seller = snap.seller && typeof snap.seller === "object" ? snap.seller : {};
      const buyer = snap.buyer && typeof snap.buyer === "object" ? snap.buyer : {};
      const doc = new jsPDF({ orientation:"portrait", unit:"mm", format:"a4" });
      const title = getGlobalInvoiceDocumentTitle(snap, invoice.status);
      doc.setFontSize(19); doc.text("PLIVEX · " + title, 16, 20);
      doc.setFontSize(9);
      if (invoice.status === "draft") doc.text("DRAFT — NOT ISSUED", 16, 26);
      doc.text("Invoice: " + String(snap.invoice_number || invoice.invoice_number || "DRAFT"), 16, 34);
      doc.text("Issue date: " + dateLabel(snap.issue_date || invoice.issue_date), 16, 40);
      doc.text("Due date: " + dateLabel(snap.due_date || invoice.due_date), 16, 46);
      doc.text("Seller: " + String(seller.legal_name || profile?.legal_name || "—"), 16, 58);
      doc.text(doc.splitTextToSize("Address: " + String(seller.address || profile?.address || "—"), 175), 16, 64);
      doc.text(registrationLabel + ": " + String(seller.tax_registration_number || "—"), 16, 78);
      const client = clients.find((c) => c.id === invoice.client_id);
      doc.text("Bill to: " + String(buyer.name || client?.name || "Customer"), 16, 90);
      if (buyer.email || client?.email) doc.text("Customer email: " + String(buyer.email || client.email), 16, 96);
      const drawTableHeader = (y) => {
        doc.setFontSize(8); doc.setFont(undefined, "bold");
        doc.text("Description", 16, y); doc.text("Qty", 112, y, { align: "right" });
        doc.text("Rate", 148, y, { align: "right" }); doc.text("Amount", 190, y, { align: "right" });
        doc.setFont(undefined, "normal");
      };
      drawTableHeader(108);
      let y = 116;
      const snapshotItems = Array.isArray(snap.items) ? snap.items : [];
      const printableItems = snapshotItems.length ? snapshotItems : lineItems;
      for (const line of printableItems) {
        const description = doc.splitTextToSize(String(line?.description || "Item"), 82);
        const rowHeight = Math.max(7, description.length * 4.5);
        if (y + rowHeight > 265) { doc.addPage(); y = 20; drawTableHeader(y); y += 8; }
        const quantity = line?.quantity === null || line?.quantity === undefined ? "—" : String(line.quantity);
        const unitPriceMinor = Number.isFinite(Number(line?.unit_price_minor)) ? Number(line.unit_price_minor) : 0;
        const lineTotalMinor = Number.isFinite(Number(line?.line_total_minor)) ? Number(line.line_total_minor) : 0;
        doc.text(description, 16, y);
        doc.text(quantity, 112, y, { align: "right" });
        doc.text(money(unitPriceMinor, invoiceCurrency), 148, y, { align: "right" });
        doc.text(money(lineTotalMinor, invoiceCurrency), 190, y, { align: "right" });
        y += rowHeight;
      }
      y += 10;
      if (y > 260) { doc.addPage(); y = 20; }
      doc.setFontSize(9);
      const totalValue = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
      doc.text("Subtotal: " + money(totalValue(invoice.subtotal_minor), invoiceCurrency), 16, y); y += 7;
      doc.text("Discount: " + money(totalValue(invoice.discount_minor), invoiceCurrency), 16, y); y += 7;
      if (snap.tax_status === "not_assessed" || snap.tax_status === "not_calculated") {
        doc.text("Tax: Not assessed by Plivex", 16, y); y += 7;
      } else {
        const taxName = experience?.business.taxName || "Tax";
        doc.text(taxName + ": " + money(totalValue(invoice.tax_minor), invoiceCurrency), 16, y); y += 7;
      }
      doc.setFontSize(13); doc.text("Total: " + money(totalValue(invoice.total_minor), invoiceCurrency), 16, y);
      doc.setFontSize(7);
      doc.text(doc.splitTextToSize(String(getGlobalInvoiceTaxDisclosure(snap) || ""), 178), 16, Math.min(282, y + 14));

      // Generate the PDF blob explicitly. This is more reliable in Android/mobile
      // browsers than jsPDF's saveAs wrapper and avoids handing an empty file to it.
      const blob = doc.output("blob");
      if (!blob || typeof blob.size !== "number" || blob.size === 0) {
        throw new Error("The invoice PDF was empty and could not be downloaded. Please try again.");
      }
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = getGlobalInvoicePdfFilename(invoice, snap);
      link.rel = "noopener";
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
      setNotice("Invoice PDF generated. Check your browser downloads.");
    } catch (e) {
      console.error("[Plivex] Global invoice PDF export failed", e);
      setError(e?.message || "Could not create invoice PDF. Please try again.");
    }
  };

  const shareInvoice = async (invoice, channel) => {
    const client = clients.find((c) => c.id === invoice.client_id);
    const buyer = invoice.invoice_snapshot?.buyer || {};
    const recipient = buyer.email || client?.email || "";
    const phone = buyer.phone || client?.phone || "";
    if (channel === "email" && !recipient) { setError("Add a customer email before sharing by email."); return; }
    if (channel === "sms" && !phone) { setError("Add a customer phone number before sharing by SMS."); return; }
    const shareWindow = channel === "whatsapp" ? window.open("about:blank","_blank") : null;
    setError(""); setNotice("");
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("global-invoice-share", {
        body:{ action:"create", workspace_id:account.workspace_id, invoice_id:invoice.id, expires_in_days:7 },
      });
      if (invokeError) throw invokeError;
      if (!data?.ok || !data?.url || !data?.share_id) throw new Error(data?.error || "Could not create a secure invoice link.");
      setActiveShare({ id:data.share_id, url:data.url, invoiceId:invoice.id, expiresAt:data.expires_at });
      const statusLine = invoice.status === "draft"
        ? "DRAFT — NOT ISSUED. This is not a tax invoice."
        : invoice.invoice_snapshot?.document_type === "commercial_invoice"
          ? "Commercial invoice. Tax was not assessed by Plivex."
          : "Issued invoice.";
      const message = "Plivex invoice " + invoice.invoice_number + " · " + money(invoice.total_minor,invoice.currency_code) +
        "\n" + statusLine + "\n\nView the secure invoice: " + data.url +
        "\n\nThis link expires in 7 days. The sender must confirm before sending.";
      if (channel === "whatsapp") {
        if (shareWindow) shareWindow.location.href = "https://wa.me/?text=" + encodeURIComponent(message);
        else window.location.href = "https://wa.me/?text=" + encodeURIComponent(message);
      } else if (channel === "email") {
        window.location.href = "mailto:" + encodeURIComponent(recipient) +
          "?subject=" + encodeURIComponent("Invoice " + invoice.invoice_number) +
          "&body=" + encodeURIComponent(message);
      } else {
        window.location.href = "sms:" + encodeURIComponent(phone) + "?body=" + encodeURIComponent(message);
      }
      setNotice("Secure invoice link created. Review the message and send it yourself; Plivex has not sent anything automatically.");
    } catch (e) {
      if (shareWindow) shareWindow.close();
      setError(e.message || "Could not create a secure invoice link.");
    }
  };

  const revokeActiveShare = async () => {
    if (!activeShare?.id) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("global-invoice-share", {
        body:{ action:"revoke", workspace_id:account.workspace_id, share_id:activeShare.id },
      });
      if (invokeError) throw invokeError;
      if (!data?.ok) throw new Error(data?.error || "Could not revoke the invoice link.");
      setActiveShare(null);
      setNotice("The selected invoice share link has been revoked.");
    } catch (e) { setError(e.message || "Could not revoke the invoice link."); }
    finally { setBusy(false); }
  };

  const recordPayment = async (event) => {
    event.preventDefault(); if (!selected) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("global-invoices", {
        body:{ action:"record_payment",workspace_id:account.workspace_id,invoice_id:selected.id,
          amount_minor:minor(paymentForm.amount,selected?.currency_code || currency),currency_code:selected?.currency_code || currency,payment_date:paymentForm.date,
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
          amount_minor:minor(refundForm.amount,selected?.currency_code || currency),currency_code:selected?.currency_code || currency,refund_date:refundForm.date,
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
  const selectedCurrency = selected?.currency_code || currency;
  const sellerProfileReady = Boolean(profile?.legal_name?.trim() && profile?.address?.trim());
  const canIssueCommercial = canIssueCommercialInvoice({
    workspaceReady:workspaceContext.ok,
    issuanceReady:backendCapabilities.commercialIssuanceReady,
    status:selected?.status,
    sellerProfileReady,
  });
  const canIssue = backendCapabilities.issuanceReady && countryCode === "GB" && selected?.status === "draft" && taxPreview.ok === true;

  return (
    <section className="mt-6 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-bold">Global invoices</h1><p className="mt-1 text-sm text-slate-500">Create and issue commercial invoices in your verified {currency || "workspace"} base currency. Tax invoices are separately enabled only where country rules and seller evidence are verified.</p></div>
        <button className={button} onClick={() => { setShowCreate((v)=>!v); setError(""); setNotice(""); }}> {showCreate ? "Close" : "Create invoice"} </button>
      </div>
      {notice && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {!workspaceContext.ok ? <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Workspace country/currency is not verified. Invoice actions are paused rather than defaulting to USD or INR.</p> : !backendCapabilities.ledgerReady || !backendCapabilities.commercialIssuanceReady ? <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">The commercial invoice migration and server function must be deployed before Global invoices can be issued. Drafts and base-currency PDF export remain available.</p> : null}

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
          <h2 className="font-semibold">New invoice draft</h2>
          <form onSubmit={createDraft} className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-600">Customer<select className={field+" mt-1"} value={form.clientId} onChange={(e)=>setForm((v)=>({...v,clientId:e.target.value}))}><option value="">No customer selected</option>{clients.map((c)=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            {countryCode==="GB" && <label className="text-xs font-semibold text-slate-600">Document type
              <select className={field+" mt-1"} value={form.documentType} onChange={(e)=>setForm((v)=>({...v,documentType:e.target.value}))}>
                <option value="commercial">Commercial invoice · tax not assessed</option>
                <option value="tax">UK VAT tax invoice · calculate VAT</option>
              </select>
            </label>}
            <label className="text-xs font-semibold text-slate-600">Issue date<input required type="date" className={field+" mt-1"} value={form.issueDate} onChange={(e)=>setForm((v)=>({...v,issueDate:e.target.value}))}/></label>
            <label className="text-xs font-semibold text-slate-600">Due date<input type="date" className={field+" mt-1"} value={form.dueDate} onChange={(e)=>setForm((v)=>({...v,dueDate:e.target.value}))}/></label>
            <label className="text-xs font-semibold text-slate-600">Description<input required maxLength={500} className={field+" mt-1"} value={form.description} onChange={(e)=>setForm((v)=>({...v,description:e.target.value}))}/></label>
            <label className="text-xs font-semibold text-slate-600">Quantity<input required min="0.0001" step="0.0001" type="number" className={field+" mt-1"} value={form.quantity} onChange={(e)=>setForm((v)=>({...v,quantity:e.target.value}))}/></label>
            <label className="text-xs font-semibold text-slate-600">Unit price
              <span className="mt-1 flex min-w-0 overflow-hidden rounded-lg border border-slate-300 bg-white focus-within:border-violet-500 focus-within:ring-2 focus-within:ring-violet-100" data-testid="global-invoice-unit-price">
                <span className="flex shrink-0 items-center border-r border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-600">{currency || "Currency"}</span>
                <input required min="0" step="0.01" type="number" className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm outline-none" value={form.unitPrice} onChange={(e)=>setForm((v)=>({...v,unitPrice:e.target.value}))}/>
              </span>
            </label>
            <div className="sm:col-span-2"><GlobalTaxEditor invoice={createPreviewInvoice} setInvoice={(updater)=>setTaxContext((old)=>typeof updater==="function"?updater({globalTax:old}).globalTax:updater.globalTax)} workspaceProfile={workspaceProfile} allowNoTax={true} serverResolved={true}/></div>
            <div className="sm:col-span-2 flex items-center justify-between gap-3"><span className="text-sm text-slate-500">Invoice amount: {money(minor(Number(form.quantity||0)*Number(form.unitPrice||0),currency),currency)}</span><button disabled={busy || !sellerProfileReady} className={button}>Save invoice draft with tax</button></div>
          </form>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-3 font-semibold">Invoices</div>
          {invoices.length===0 ? <p className="p-8 text-center text-sm text-slate-500">No Global invoices yet. Create a final invoice to issue its server-generated number and download the official PDF.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-3">Invoice</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Total</th></tr></thead><tbody className="divide-y divide-slate-100">{invoices.map((invoice)=><tr key={invoice.id} className={selectedId===invoice.id?"bg-violet-50":""}><td className="px-3 py-3"><button className="font-semibold text-violet-700" onClick={()=>setSelectedId(invoice.id)}>{invoice.invoice_number}</button><div className="text-xs text-slate-500">{invoice.issue_date}</div></td><td className="px-3 py-3">{invoice.status}</td><td className="px-3 py-3">{money(invoice.total_minor,invoice.currency_code)}</td></tr>)}</tbody></table></div>}
        </div>
        <div className="space-y-4">
          {selected ? <>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="font-semibold">{selected.invoice_number}</h2>
              <p className="mt-1 text-sm text-slate-500">{selected.invoice_snapshot?.buyer?.name || selectedClient?.name || "Customer"} · {selected.status}</p>
              <div className="mt-3 space-y-1 text-sm"><p>Subtotal: {money(selected.subtotal_minor,selected.currency_code)}</p><p>Discount: {money(selected.discount_minor,selected.currency_code)}</p><p>{selected.invoice_snapshot?.global_tax_snapshot?.status === "not_assessed" || selected.invoice_snapshot?.tax_status === "not_assessed" ? "Tax: Not assessed by Plivex" : "Tax: " + money(selected.tax_minor,selected.currency_code)}</p><p className="font-bold">Total: {money(selected.total_minor,selected.currency_code)}</p></div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button className={secondary} onClick={()=>downloadPdf(selected)}>Download PDF</button>
                <button className={secondary} onClick={()=>shareInvoice(selected,"whatsapp")}>WhatsApp</button>
                <button className={secondary} onClick={()=>shareInvoice(selected,"email")}>Email</button>
                <button className={secondary} onClick={()=>shareInvoice(selected,"sms")}>SMS</button>
                {activeShare?.invoiceId === selected.id && <button className={secondary} disabled={busy} onClick={revokeActiveShare}>Revoke active link</button>}
              </div>
              {selected.status==="draft" && <>
                <button className={button+" mt-4 w-full"} disabled={busy||!canIssueCommercial} onClick={issueCommercialInvoice}>Issue commercial invoice</button>
                {!canIssueCommercial && <p className="mt-2 text-xs text-amber-700">Complete the seller legal name and address, and wait for the commercial issuance service to be enabled. Commercial invoices do not certify tax treatment.</p>}
                {countryCode==="GB" && <>
                  <div className="mt-4"><GlobalTaxEditor invoice={previewInvoice} setInvoice={(updater)=>setTaxContext((old)=>typeof updater==="function"?updater({globalTax:old}).globalTax:updater.globalTax)} workspaceProfile={workspaceProfile} serverResolved={true}/></div>
                  <button className={secondary+" mt-3 w-full"} disabled={busy||!canIssue} onClick={issueInvoice}>Issue UK VAT tax invoice</button>
                  {!canIssue && <p className="mt-2 text-xs text-amber-700">The separate UK VAT tax-invoice path requires a complete registered seller profile and confirmed standard-rated VAT evidence.</p>}
                </>}
                <p className="mt-3 text-xs text-slate-500">This invoice draft stores the selected Workspace-country tax rule and a versioned calculation snapshot. Draft-test rates are not legally verified.</p>
              </>}
              {selected.status!=="draft" && <p className="mt-3 text-xs text-slate-500">Issued invoice content and tax snapshot are locked. Payments and refunds are recorded separately.</p>}
            </div>
            {countryCode === "IN" && ["issued","partially_paid","paid","overdue"].includes(selected.status) && (
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="font-semibold">Manual GST portal references</h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">Enter IRN / acknowledgement and E-Way Bill details after obtaining them from the relevant portal. Plivex does not call or verify with GSTN, IRP or E-Way Bill services.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-semibold text-slate-600">IRN (64-character hash)<input className={field+" mt-1"} maxLength={64} value={indiaComplianceForm.irn} onChange={(e)=>setIndiaComplianceForm((v)=>({...v,irn:e.target.value}))}/></label>
                  <label className="text-xs font-semibold text-slate-600">Acknowledgement number<input className={field+" mt-1"} maxLength={15} value={indiaComplianceForm.ack_number} onChange={(e)=>setIndiaComplianceForm((v)=>({...v,ack_number:e.target.value}))}/></label>
                  <label className="text-xs font-semibold text-slate-600">Acknowledgement date<input className={field+" mt-1"} type="date" value={indiaComplianceForm.ack_date} onChange={(e)=>setIndiaComplianceForm((v)=>({...v,ack_date:e.target.value}))}/></label>
                  <label className="text-xs font-semibold text-slate-600">E-Way Bill number<input className={field+" mt-1"} maxLength={12} value={indiaComplianceForm.eway_bill_number} onChange={(e)=>setIndiaComplianceForm((v)=>({...v,eway_bill_number:e.target.value}))}/></label>
                  <label className="text-xs font-semibold text-slate-600">E-Way Bill date<input className={field+" mt-1"} type="date" value={indiaComplianceForm.eway_bill_date} onChange={(e)=>setIndiaComplianceForm((v)=>({...v,eway_bill_date:e.target.value}))}/></label>
                  <label className="text-xs font-semibold text-slate-600">Valid until<input className={field+" mt-1"} type="date" value={indiaComplianceForm.eway_bill_valid_until} onChange={(e)=>setIndiaComplianceForm((v)=>({...v,eway_bill_valid_until:e.target.value}))}/></label>
                  <label className="text-xs font-semibold text-slate-600">Transport mode<select className={field+" mt-1"} value={indiaComplianceForm.transport_mode} onChange={(e)=>setIndiaComplianceForm((v)=>({...v,transport_mode:e.target.value}))}><option value="road">Road</option><option value="rail">Rail</option><option value="air">Air</option><option value="ship">Ship</option></select></label>
                  <label className="text-xs font-semibold text-slate-600">Vehicle number<input className={field+" mt-1"} maxLength={20} value={indiaComplianceForm.vehicle_number} onChange={(e)=>setIndiaComplianceForm((v)=>({...v,vehicle_number:e.target.value}))}/></label>
                  <label className="text-xs font-semibold text-slate-600">Transporter GSTIN<input className={field+" mt-1"} maxLength={15} value={indiaComplianceForm.transporter_id} onChange={(e)=>setIndiaComplianceForm((v)=>({...v,transporter_id:e.target.value}))}/></label>
                  <label className="text-xs font-semibold text-slate-600">Transporter name<input className={field+" mt-1"} maxLength={120} value={indiaComplianceForm.transporter_name} onChange={(e)=>setIndiaComplianceForm((v)=>({...v,transporter_name:e.target.value}))}/></label>
                  <label className="text-xs font-semibold text-slate-600">Distance (km)<input className={field+" mt-1"} type="number" min="1" max="4000" step="1" value={indiaComplianceForm.distance_km} onChange={(e)=>setIndiaComplianceForm((v)=>({...v,distance_km:e.target.value}))}/></label>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" className={button} disabled={busy} onClick={saveIndiaCompliance}>Save references</button>
                  <button type="button" className={secondary} disabled={busy} onClick={()=>downloadIndiaDetails("e_invoice")}>Export E-Invoice details JSON</button>
                  <button type="button" className={secondary} disabled={busy} onClick={()=>downloadIndiaDetails("e_way_bill")}>Export E-Way Bill details JSON</button>
                </div>
              </div>
            )}
            {backendCapabilities.ledgerReady && ["issued","partially_paid","overdue"].includes(selected.status) && (
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="font-semibold">Record payment</h3>
                <form className="mt-3 grid gap-2" onSubmit={recordPayment}>
                  <input required min="0.01" step="0.01" type="number" className={field} placeholder={`Amount (${selected?.currency_code || currency})`} value={paymentForm.amount} onChange={(e)=>setPaymentForm((v)=>({...v,amount:e.target.value}))}/>
                  <input required type="date" className={field} value={paymentForm.date} onChange={(e)=>setPaymentForm((v)=>({...v,date:e.target.value}))}/>
                  <input className={field} placeholder="Method" value={paymentForm.method} onChange={(e)=>setPaymentForm((v)=>({...v,method:e.target.value}))}/>
                  <input className={field} placeholder="Reference" value={paymentForm.reference} onChange={(e)=>setPaymentForm((v)=>({...v,reference:e.target.value}))}/>
                  <button disabled={busy} className={button}>Add payment entry</button>
                </form>
              </div>
            )}
            {backendCapabilities.ledgerReady && selected.amount_paid_minor>selected.amount_refunded_minor && (
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="font-semibold">Record refund</h3>
                <form className="mt-3 grid gap-2" onSubmit={recordRefund}>
                  <input required min="0.01" step="0.01" type="number" className={field} placeholder={`Amount (${selected?.currency_code || currency})`} value={refundForm.amount} onChange={(e)=>setRefundForm((v)=>({...v,amount:e.target.value}))}/>
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

      {backendCapabilities.ledgerReady ? <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="font-semibold">Payment reconciliation</div>
        <p className="mt-1 text-xs text-slate-500">Gross payments less recorded refunds. This is an internal ledger view, not a bank statement.</p>
        <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="p-2">Invoice</th><th className="p-2">Gross paid</th><th className="p-2">Refunds</th><th className="p-2">Net received</th><th className="p-2">Outstanding</th></tr></thead><tbody className="divide-y divide-slate-100">{reconciliation.map((row)=><tr key={row.invoice_id}><td className="p-2">{row.invoice_number}</td><td className="p-2">{money(row.gross_payments_minor,row.currency_code)}</td><td className="p-2">{money(row.refunds_minor,row.currency_code)}</td><td className="p-2">{money(row.net_received_minor,row.currency_code)}</td><td className="p-2">{money(row.outstanding_minor,row.currency_code)}</td></tr>)}</tbody></table></div>
      </div> : null}
    </section>
  );
}
