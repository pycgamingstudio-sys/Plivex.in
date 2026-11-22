import { parseIndianGstin } from "./gstin.js";

const round2 = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const clean = (value) => String(value ?? "").trim();
const invoiceDate = (invoice, snapshot) => clean(invoice.issueDate || invoice.issue_date || snapshot.issueDate).slice(0, 10);

function normalizeInvoice(invoice) {
  const snapshot = invoice?.invoiceSnapshot && typeof invoice.invoiceSnapshot === "object"
    ? invoice.invoiceSnapshot
    : invoice?.invoice_snapshot && typeof invoice.invoice_snapshot === "object"
      ? invoice.invoice_snapshot : {};
  const items = Array.isArray(invoice?.items) && invoice.items.length
    ? invoice.items : Array.isArray(snapshot.items) ? snapshot.items : [];
  const subtotal = Math.max(0, Number(invoice?.subtotal ?? snapshot.subtotal ?? 0) || 0);
  const discount = Math.max(0, Number(invoice?.discount ?? snapshot.discount ?? 0) || 0);
  const discountType = invoice?.discountType || invoice?.discount_type || snapshot.discountType || "percent";
  const discountValue = discountType === "flat" ? Math.min(discount, subtotal) : Math.min(subtotal, subtotal * Math.min(discount, 100) / 100);
  const rows = items.map((item) => {
    const quantity = Math.max(0, Number(item?.quantity) || 0);
    const rate = Math.max(0, Number(item?.rate) || 0);
    const lineValue = quantity * rate;
    const allocatedDiscount = subtotal > 0 ? discountValue * lineValue / subtotal : 0;
    const taxableValue = Math.max(0, lineValue - allocatedDiscount);
    const gstRate = Math.max(0, Number(item?.gstRate ?? item?.gst_rate ?? snapshot.taxRate ?? 0) || 0);
    return {
      description: clean(item?.description),
      hsnSac: clean(item?.hsnSac || item?.hsn_sac || item?.hsn_code),
      quantity,
      taxableValue: round2(taxableValue),
      gstRate,
      taxValue: round2(taxableValue * gstRate / 100),
    };
  });
  const taxMode = (invoice?.taxMode || invoice?.tax_mode || snapshot.taxMode || "split") === "igst" ? "igst" : "split";
  const taxableValue = round2(rows.reduce((sum, row) => sum + row.taxableValue, 0));
  const taxValue = round2(rows.reduce((sum, row) => sum + row.taxValue, 0));
  return {
    snapshot,
    items: rows,
    number: clean(invoice?.number || invoice?.invoiceNumber || snapshot.number),
    date: invoiceDate(invoice, snapshot),
    status: clean(invoice?.status).toLowerCase(),
    isDraft: Boolean(invoice?.isDraft ?? invoice?.is_draft ?? snapshot.isDraft),
    sellerGstin: clean(snapshot.business?.gstin || snapshot.business?.tax_registration_number || invoice?.businessGstin),
    buyerGstin: clean(snapshot.client?.gstin || snapshot.client?.tax_registration_number || invoice?.clientGstin),
    buyerName: clean(invoice?.clientName || invoice?.client_name || snapshot.client?.name || snapshot.client?.company),
    invoiceValue: round2(Number(invoice?.total ?? snapshot.total ?? (taxableValue + taxValue)) || 0),
    taxableValue,
    taxValue,
    taxMode,
  };
}

function taxColumns(taxable, rate, mode) {
  const tax = round2(taxable * rate / 100);
  return mode === "igst"
    ? { igstAmount: tax, cgstAmount: 0, sgstAmount: 0 }
    : { igstAmount: 0, cgstAmount: round2(tax / 2), sgstAmount: round2(tax - round2(tax / 2)) };
}

export function buildGstr1Draft(invoices, { from = "", to = "" } = {}) {
  const b2b = [];
  const b2c = [];
  const hsnMap = new Map();
  const warnings = [];
  const eligible = (Array.isArray(invoices) ? invoices : []).filter((invoice) => {
    const row = normalizeInvoice(invoice);
    return !row.isDraft && !["draft", "cancelled", "canceled", "void"].includes(row.status)
      && row.date && (!from || row.date >= from) && (!to || row.date <= to);
  });
  let missingSellerGstin = false;
  let invalidBuyerGstin = 0;
  let missingHsn = 0;

  for (const invoice of eligible) {
    const row = normalizeInvoice(invoice);
    const seller = parseIndianGstin(row.sellerGstin);
    const buyer = row.buyerGstin ? parseIndianGstin(row.buyerGstin) : null;
    if (!seller.ok) missingSellerGstin = true;
    if (row.buyerGstin && !buyer?.ok) invalidBuyerGstin += 1;
    const target = buyer?.ok ? b2b : row.buyerGstin ? null : b2c;
    if (!target) continue;
    const grouped = new Map();
    for (const item of row.items) {
      const key = String(item.gstRate);
      const current = grouped.get(key) || { taxable: 0, tax: 0 };
      current.taxable += item.taxableValue;
      current.tax += item.taxValue;
      const hsn = item.hsnSac || "NOT_RECORDED";
      if (!item.hsnSac) missingHsn += 1;
      const hsnKey = hsn + "|" + key;
      const summary = hsnMap.get(hsnKey) || {
        hsnSac: hsn, description: item.description, gstRate: item.gstRate,
        totalQuantity: 0, taxableValue: 0, igstAmount: 0, cgstAmount: 0, sgstAmount: 0,
      };
      summary.totalQuantity += item.quantity;
      summary.taxableValue += item.taxableValue;
      const columns = taxColumns(item.taxableValue, item.gstRate, row.taxMode);
      summary.igstAmount += columns.igstAmount;
      summary.cgstAmount += columns.cgstAmount;
      summary.sgstAmount += columns.sgstAmount;
      hsnMap.set(hsnKey, summary);
      grouped.set(key, current);
    }
    for (const [rateKey, amounts] of grouped) {
      const rate = Number(rateKey);
      const columns = taxColumns(amounts.taxable, rate, row.taxMode);
      const common = {
        invoiceNumber: row.number,
        invoiceDate: row.date,
        recipientName: row.buyerName || "Unregistered customer",
        placeOfSupply: buyer?.stateCode || "NOT_RECORDED",
        invoiceValue: row.invoiceValue,
        rate,
        taxableValue: round2(amounts.taxable),
        ...columns,
        cessAmount: 0,
      };
      if (buyer?.ok) b2b.push({ recipientGstin: buyer.gstin, ...common });
      else b2c.push(common);
    }
  }
  if (missingSellerGstin) warnings.push("Seller GSTIN is missing or has an invalid format; confirm registration details before filing.");
  if (invalidBuyerGstin) warnings.push(`${invalidBuyerGstin} invoice(s) have a GSTIN that failed format validation and were excluded from B2B/B2C export.`);
  if (missingHsn) warnings.push(`${missingHsn} line(s) have no HSN/SAC and appear as NOT_RECORDED in the HSN summary.`);
  if (b2c.some((row) => row.placeOfSupply === "NOT_RECORDED")) warnings.push("Place of supply is not recorded for some unregistered-customer invoices; verify it before filing.");
  const hsn = [...hsnMap.values()].map((row) => ({
    ...row,
    totalQuantity: round2(row.totalQuantity),
    taxableValue: round2(row.taxableValue),
    igstAmount: round2(row.igstAmount),
    cgstAmount: round2(row.cgstAmount),
    sgstAmount: round2(row.sgstAmount),
    cessAmount: 0,
  })).sort((a, b) => a.hsnSac.localeCompare(b.hsnSac) || a.gstRate - b.gstRate);
  return { b2b, b2c, hsn, warnings, invoiceCount: eligible.length };
}
