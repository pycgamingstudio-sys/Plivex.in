const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (value) => {
  if (!DATE.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
};
const clean = (value, max = 160) => typeof value === "string" ? value.trim().slice(0, max) : "";

export function normalizeIndiaCompliance(input = {}) {
  const value = {
    irn: clean(input.irn, 64).toUpperCase(),
    ack_number: clean(input.ack_number, 20),
    ack_date: clean(input.ack_date, 10),
    eway_bill_number: clean(input.eway_bill_number, 20),
    eway_bill_date: clean(input.eway_bill_date, 10),
    eway_bill_valid_until: clean(input.eway_bill_valid_until, 10),
    transport_mode: clean(input.transport_mode, 20).toLowerCase(),
    vehicle_number: clean(input.vehicle_number, 20).toUpperCase(),
    transporter_id: clean(input.transporter_id, 15).toUpperCase(),
    transporter_name: clean(input.transporter_name, 120),
    distance_km: input.distance_km === "" || input.distance_km === null || input.distance_km === undefined
      ? null : Number(input.distance_km),
  };
  if (value.irn && !/^[A-F0-9]{64}$/.test(value.irn)) return { ok:false, error:"IRN must be 64 hexadecimal characters." };
  if (value.ack_number && !/^\d{15}$/.test(value.ack_number)) return { ok:false, error:"Acknowledgement number must contain 15 digits." };
  if (value.ack_date && !isDate(value.ack_date)) return { ok:false, error:"Enter a valid acknowledgement date." };
  if (value.eway_bill_number && !/^\d{12}$/.test(value.eway_bill_number)) return { ok:false, error:"E-Way Bill number must contain 12 digits." };
  if (value.eway_bill_date && !isDate(value.eway_bill_date)) return { ok:false, error:"Enter a valid E-Way Bill date." };
  if (value.eway_bill_valid_until && !isDate(value.eway_bill_valid_until)) return { ok:false, error:"Enter a valid E-Way Bill validity date." };
  if (value.transport_mode && !["road","rail","air","ship"].includes(value.transport_mode)) return { ok:false, error:"Choose a supported transport mode." };
  if (value.vehicle_number && !/^[A-Z0-9 -]{4,20}$/.test(value.vehicle_number)) return { ok:false, error:"Enter a valid vehicle number." };
  if (value.transporter_id && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(value.transporter_id)) return { ok:false, error:"Transporter ID must be a 15-character GSTIN format." };
  if (value.distance_km !== null && (!Number.isSafeInteger(value.distance_km) || value.distance_km < 1 || value.distance_km > 4000)) return { ok:false, error:"Distance must be a whole number between 1 and 4,000 km." };
  return {
    ok:true,
    value:Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item === "" ? null : item])),
  };
}

export function buildIndiaComplianceDetailsExport({ invoice, items = [], seller = {}, buyer = {}, compliance = {}, exportType = "e_invoice" }) {
  const invoiceNumber = String(invoice?.invoice_number || invoice?.invoice_snapshot?.number || "invoice");
  return {
    schema: "plivex.india.manual-compliance-details.v1",
    export_type: exportType,
    generated_at: new Date().toISOString(),
    notice: "Manual details export only. This is not a government portal submission, IRP/E-Way Bill API payload, or verification of the entered references.",
    seller: {
      legal_name: seller.legal_name || seller.display_name || seller.name || "",
      gstin: seller.tax_registration_number || seller.gstin || "",
      address: seller.address || "",
      email: seller.email || "",
      phone: seller.phone || "",
    },
    buyer: {
      name: buyer.name || buyer.legal_name || "",
      gstin: buyer.tax_registration_number || buyer.gstin || "",
      address: buyer.address || "",
      email: buyer.email || "",
      phone: buyer.phone || "",
    },
    document: {
      invoice_number: invoiceNumber,
      issue_date: invoice?.issue_date || invoice?.invoice_snapshot?.issueDate || null,
      due_date: invoice?.due_date || invoice?.invoice_snapshot?.dueDate || null,
      status: invoice?.status || null,
      currency_code: invoice?.currency_code || invoice?.invoice_snapshot?.currency || "INR",
      subtotal_minor: Number(invoice?.subtotal_minor || 0),
      discount_minor: Number(invoice?.discount_minor || 0),
      tax_minor: Number(invoice?.tax_minor || 0),
      total_minor: Number(invoice?.total_minor || 0),
    },
    line_items: items.map((item) => ({
      description: item.description || "",
      quantity: Number(item.quantity || 0),
      unit_price_minor: Number(item.unit_price_minor || 0),
      discount_minor: Number(item.discount_minor || 0),
      tax_code: item.tax_code || null,
    })),
    tax_snapshot: invoice?.invoice_snapshot?.global_tax_snapshot || invoice?.invoice_snapshot?.tax_snapshot || null,
    india_compliance: compliance || {},
  };
}
