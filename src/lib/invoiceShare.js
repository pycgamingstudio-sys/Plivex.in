import { supabase } from "@/api/backendClient";

export async function createInvoiceShareLink(invoiceId) {
  // Unified Main Workspace stores every country's invoice in the canonical
  // public invoice ledger. The isolated Global share API is legacy-only.
  const { data, error } = await supabase.functions.invoke("invoice-share", {
    body: { action: "create", invoiceId },
  });
  if (error) {
    let message = error.message || "Could not create invoice link.";
    try { const responseBody = await error.context?.clone?.().json(); if (responseBody?.error) message = responseBody.error; } catch {}
    throw new Error(message);
  }
  if (!data?.url) throw new Error(data?.error || "Could not create invoice link.");
  return data;
}
