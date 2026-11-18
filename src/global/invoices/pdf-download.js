export function normalizeGlobalInvoiceSnapshot(snapshot) {
  if (typeof snapshot === "string") {
    try {
      const parsed = JSON.parse(snapshot);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot : {};
}

export function getGlobalInvoicePdfFilename(invoice = {}, snapshot = {}) {
  const source = snapshot.invoice_number || invoice.invoice_number || "Plivex-invoice";
  const safe = String(source)
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 100);
  return (safe || "Plivex-invoice") + ".pdf";
}
