import React from "react";
import { createRoot } from "react-dom/client";
import { InvoiceDesign } from "@/components/invoice/designs";
import { amountInWords } from "@/lib/currency";

const A4_WIDTH = 794;

const formatMoney = (value, currency) => new Intl.NumberFormat("en", {
  style: "currency", currency: currency || "INR",
}).format(Number(value || 0));

export async function createQuotationPdfBlob(quotation) {
  if (!quotation?.number) throw new Error("Save this quotation before exporting its PDF.");
  const business = quotation.business || {};
  const sourceItems = Array.isArray(quotation.items) ? quotation.items : [];
  const items = sourceItems.map((item, index) => ({
    id: item.id || `quotation-item-${index}`,
    description: String(item.description || "Item"),
    quantity: Number(item.quantity) || 0,
    rate: Number(item.rate) || 0,
    gstRate: Number(quotation.taxRate) || 0,
  }));
  if (Number(quotation.shipping) > 0) {
    items.push({ id: "quotation-shipping", description: "Shipping / handling", quantity: 1, rate: Number(quotation.shipping), gstRate: 0 });
  }
  const itemSubtotal = sourceItems.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.rate) || 0), 0);
  const pctDiscount = itemSubtotal * (Number(quotation.pctDiscount) || 0) / 100;
  const discountValue = Math.min(itemSubtotal, pctDiscount + (Number(quotation.flatDiscount) || 0));
  const taxValue = Math.max(0, itemSubtotal - discountValue) * (Number(quotation.taxRate) || 0) / 100;
  const invoiceModel = {
    documentTitle: "Quotation",
    documentSubtitle: "Price proposal",
    issueDateLabel: "Quotation date",
    expiryDateLabel: "Valid until",
    clientHeading: "Prepared for",
    totalHeading: "Quoted total",
    totalLabel: "Quotation total",
    business: {
      name: business.name || "Your business",
      email: business.email || "",
      phone: business.phone || "",
      gstin: business.gstin || "",
      address: business.address || "",
    },
    client: { name: quotation.clientName || "Customer", company: "", email: quotation.clientEmail || "", phone: "", address: "", gstin: "" },
    logo: business.logo || "",
    number: quotation.number,
    issueDate: quotation.date || "",
    dueDate: quotation.validUntil || "",
    currency: quotation.currency || "INR",
    items,
    taxRate: Number(quotation.taxRate) || 0,
    taxMode: "single",
    discountType: "fixed",
    discount: discountValue,
    notes: quotation.notes || "",
    terms: quotation.terms || "",
    signature: quotation.signature || "",
    globalTax: null,
    globalTaxProfileSnapshot: null,
  };
  const subtotal = itemSubtotal + Math.max(0, Number(quotation.shipping) || 0);
  const total = Number(quotation.total) || Math.max(0, itemSubtotal - discountValue) + taxValue + Math.max(0, Number(quotation.shipping) || 0);
  const money = (value, currency) => {
    return formatMoney(Number(value || 0), currency || "INR");
  };
  const stage = document.createElement("div");
  stage.style.cssText = `position:fixed;left:-10000px;top:0;width:${A4_WIDTH}px;z-index:-1;pointer-events:none;background:#fff;`;
  document.body.appendChild(stage);
  const root = createRoot(stage);
  let canvas;
  try {
    root.render(React.createElement("div", {
      className: "relative w-[794px] overflow-hidden bg-white text-[#28263a]",
      "data-testid": "quotation-pdf-preview",
    }, React.createElement(InvoiceDesign, {
      design: quotation.design || "classic",
      invoice: invoiceModel,
      subtotal,
      discount: discountValue,
      discountValue,
      taxValue,
      total,
      upiValid: false,
      qrUrl: "",
      money,
      dateLabel: (value) => value ? new Date(`${value}T00:00:00`).toLocaleDateString() : "—",
      amountInWords: (value, currency) => amountInWords(value, currency),
    })));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (document.fonts?.ready) await document.fonts.ready;
    const preview = stage.firstElementChild;
    if (!preview) throw new Error("Quotation preview could not be prepared.");
    await Promise.all([...preview.querySelectorAll("img")].map((img) => img.decode?.().catch(() => undefined)));
    const html2canvasModule = await import("html2canvas");
    const { jsPDF } = await import("jspdf");
    canvas = await html2canvasModule.default(preview, {
      scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false,
      windowWidth: A4_WIDTH, imageTimeout: 5000,
    });
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
    pdf.setProperties({
      title: `Plivex Quotation ${quotation.number}`,
      subject: "Quotation",
      creator: "Plivex — Smart Invoicing & Business OS",
      author: business.name || "Plivex",
    });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const marginX = 7, marginTop = 7, marginBottom = 12;
    const scale = Math.min((pageWidth - marginX * 2) / canvas.width, (pageHeight - marginTop - marginBottom) / canvas.height);
    const width = canvas.width * scale, height = canvas.height * scale;
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", (pageWidth - width) / 2, marginTop + Math.max(0, (pageHeight - marginTop - marginBottom - height) / 2), width, height, undefined, "FAST");
    const pageCount = pdf.getNumberOfPages();
    for (let page = 1; page <= pageCount; page += 1) {
      pdf.setPage(page);
      pdf.setFontSize(7); pdf.setTextColor(120);
      pdf.text(`Page ${page} of ${pageCount}`, pageWidth - 8, pageHeight - 4, { align: "right" });
    }
    const blob = pdf.output("blob");
    if (!blob || blob.size <= 0) throw new Error("The quotation PDF was empty. Please try again.");
    return blob;
  } finally {
    root.unmount();
    stage.remove();
  }
}
