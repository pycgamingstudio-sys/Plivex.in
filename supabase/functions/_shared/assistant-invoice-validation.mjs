const SUPPORTED_CURRENCIES = new Set(["INR", "USD", "EUR", "GBP", "AED", "CAD", "AUD", "SGD"]);
const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const number = (value, fallback = NaN) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** Shared runtime validator for AI-generated and deterministic invoice actions. */
export function validateInvoiceAction(action) {
  if (!action || typeof action !== "object") return null;
  if (text(action.type, 40) !== "create_invoice") return null;
  const raw = action.payload && typeof action.payload === "object" ? action.payload : {};
  const client_name = text(raw.client_name, 120);
  const currency = text(raw.currency, 3).toUpperCase() || "INR";
  if (!SUPPORTED_CURRENCIES.has(currency)) return null;

  const items = Array.isArray(raw.items) ? raw.items.slice(0, 100).map((entry) => ({
    description: text(entry?.description, 500),
    quantity: number(entry?.quantity, -1),
    rate: number(entry?.rate, -1),
    gst_rate: number(entry?.gst_rate, 0),
  })) : [];
  if (!client_name || !items.length || items.some((item) =>
    !item.description || !(item.quantity > 0) || !(item.rate >= 0) ||
    item.gst_rate < 0 || item.gst_rate > 100
  )) return null;

  const tax_mode = raw.tax_mode === "igst" ? "igst" : "split";
  const discount_type = raw.discount_type === "flat" ? "flat" : "percent";
  const discount = number(raw.discount, 0);
  const tax_rate = number(raw.tax_rate, 0);
  if (tax_rate < 0 || tax_rate > 100 || discount < 0 ||
      (discount_type === "percent" && discount > 100)) return null;

  const validIsoDate = (value) => {
    const candidate = String(value ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return undefined;
    const parsed = new Date(candidate + "T00:00:00.000Z");
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate
      ? candidate
      : undefined;
  };
  const issue_date = validIsoDate(raw.issue_date);
  const due_date = validIsoDate(raw.due_date);
  if ((raw.issue_date && !issue_date) || (raw.due_date && !due_date)) return null;
  const rawSnapshot = raw.invoice_snapshot && typeof raw.invoice_snapshot === "object" ? raw.invoice_snapshot : {};
  const rawSnapshotBusiness = rawSnapshot.business && typeof rawSnapshot.business === "object" ? rawSnapshot.business : {};
  const rawSnapshotClient = rawSnapshot.client && typeof rawSnapshot.client === "object" ? rawSnapshot.client : {};
  const rawSnapshotItems = Array.isArray(rawSnapshot.items) ? rawSnapshot.items : [];

  const invoice_snapshot = {
    business: {
      name: text(rawSnapshotBusiness.name || raw.business_name, 160),
      email: text(rawSnapshotBusiness.email, 180),
      phone: text(rawSnapshotBusiness.phone, 40),
      gstin: text(rawSnapshotBusiness.gstin, 30),
      address: text(rawSnapshotBusiness.address, 400),
    },
    client: {
      name: client_name,
      company: text(rawSnapshotClient.company, 120),
      email: text(raw.client_email || rawSnapshotClient.email, 180),
      phone: text(rawSnapshotClient.phone, 40),
      gstin: text(rawSnapshotClient.gstin, 30),
      address: text(rawSnapshotClient.address, 400),
    },
    number: text(rawSnapshot.number, 80),
    issueDate: issue_date || "",
    dueDate: due_date || "",
    currency,
    items: items.map((item, index) => ({
      id: text(rawSnapshotItems[index]?.id, 80) || "ai-item-" + (index + 1),
      description: item.description,
      quantity: item.quantity,
      rate: item.rate,
      gstRate: item.gst_rate,
    })),
    taxRate: tax_rate,
    taxMode: tax_mode,
    discountType: discount_type,
    discount,
    notes: text(raw.notes || rawSnapshot.notes, 1000),
    terms: text(raw.terms || rawSnapshot.terms, 1000),
    upiId: text(rawSnapshot.upiId, 180),
    logo: text(rawSnapshot.logo, 2000),
    design: ["classic", "modern", "minimal"].includes(text(rawSnapshot.design, 30))
      ? text(rawSnapshot.design, 30)
      : "classic",
  };

  return {
    type: "create_invoice",
    payload: {
      client_name,
      client_email: text(raw.client_email, 180),
      business_name: text(raw.business_name, 160),
      issue_date,
      due_date,
      currency,
      tax_mode,
      tax_rate,
      discount_type,
      discount,
      notes: text(raw.notes, 1000),
      terms: text(raw.terms, 1000),
      status: "Pending",
      is_draft: true,
      items,
      invoice_snapshot,
    },
  };
}
