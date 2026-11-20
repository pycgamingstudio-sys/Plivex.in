import React from "react";
import { createRoot } from "react-dom/client";
import { InvoicePreview } from "@/pages/Home";

const A4_WIDTH = 826;

export async function createInvoicePdfBlob(record, fallbackCurrency = "INR") {
  const saved = record?.invoiceSnapshot;
  const hasSnapshot = saved && typeof saved === "object" && saved.business && saved.client && Array.isArray(saved.items);
  const invoice = hasSnapshot ? {
    ...saved,
    number: record.number || saved.number || "INV-000",
    issueDate: record.issueDate || saved.issueDate || "",
    dueDate: record.dueDate || saved.dueDate || "",
    currency: record.currency || saved.currency || fallbackCurrency,
    design: saved.design || "classic",
  } : {
    business: { name: record.businessName || "Your business", email: "", phone: "", gstin: "", address: "" },
    client: { name: record.clientName || "Client", company: "", email: record.clientEmail || "", phone: "", gstin: "", address: "" },
    number: record.number || "INV-000",
    issueDate: record.issueDate || "",
    dueDate: record.dueDate || "",
    currency: record.currency || fallbackCurrency,
    items: (record.items || []).map((item, index) => ({ ...item, id: item.id || `history-item-${index}` })),
    taxRate: Number(record.taxRate) || 0,
    taxMode: record.taxMode || "split",
    discountType: record.discountType || "percent",
    discount: Number(record.discount) || 0,
    notes: record.notes || "",
    terms: record.terms || "",
    design: "classic",
  };
  if (!Array.isArray(invoice.items)) throw new Error("Invoice items are unavailable for PDF sharing.");
  const stage = document.createElement("div");
  stage.style.cssText = `position:fixed;left:0;top:0;width:${A4_WIDTH}px;z-index:-1;pointer-events:none;background:#fff;`;
  document.body.appendChild(stage);
  const root = createRoot(stage);
  try {
    root.render(React.createElement(InvoicePreview, { invoice, design: invoice.design || "classic" }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (document.fonts?.ready) await document.fonts.ready;
    const source = stage.querySelector("[data-testid='invoice-preview']");
    if (!source) throw new Error("Invoice preview could not be prepared.");
    await Promise.all([...source.querySelectorAll("img")].map((img) => img.decode?.().catch(() => undefined)));
    const qrImage = source.querySelector('img[alt="UPI payment QR code"]');
    if (qrImage && !qrImage.naturalWidth) throw new Error("Invoice QR image could not be loaded. Please retry.");
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
    const canvas = await html2canvas(source, {
      scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false,
      windowWidth: A4_WIDTH, imageTimeout: 5000,
    });
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
    pdf.setProperties({
      title: `Plivex Invoice ${invoice.number || ""}`,
      subject: "Invoice",
      creator: "Plivex — Smart Invoicing & Business OS",
      author: invoice.business?.name || "Plivex",
    });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const marginX = 7, marginTop = 7, marginBottom = 12;
    const scale = Math.min((pageWidth - marginX * 2) / canvas.width, (pageHeight - marginTop - marginBottom) / canvas.height);
    const width = canvas.width * scale;
    const height = canvas.height * scale;
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", (pageWidth - width) / 2, marginTop + Math.max(0, (pageHeight - marginTop - marginBottom - height) / 2), width, height, undefined, "FAST");
    const pageCount = pdf.getNumberOfPages();
    for (let page = 1; page <= pageCount; page += 1) {
      pdf.setPage(page);
      pdf.setFontSize(7);
      pdf.setTextColor(120);
      pdf.text(`Page ${page} of ${pageCount}`, pageWidth - 8, pageHeight - 4, { align: "right" });
    }
    const blob = pdf.output("blob");
    if (!blob || blob.size <= 0) throw new Error("The invoice PDF was empty. Please retry.");
    return blob;
  } finally {
    root.unmount();
    stage.remove();
  }
}

export function getInvoicePdfFilename(record) {
  const number = String(record?.number || "INV-000").replace(/[^a-zA-Z0-9]+/g, "-");
  return `Plivex_${number}.pdf`;
}
