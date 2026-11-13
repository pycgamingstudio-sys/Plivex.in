import { supabase } from "@/api/backendClient";

export async function createInvoiceShareLink(invoiceId) {
  const { data, error } = await supabase.functions.invoke("invoice-share", {
    body: { action: "create", invoiceId },
  });
  if (error) {
    let message = error.message || "Could not create invoice link.";
    try { const body = await error.context?.clone?.().json(); if (body?.error) message = body.error; } catch {}
    throw new Error(message);
  }
  if (!data?.url) throw new Error(data?.error || "Could not create invoice link.");
  return data;
}
