import { supabase } from "@/api/backendClient";

export async function createInvoiceShareLink(invoiceId, workspaceId, isGlobalWorkspace = false) {
  const functionName = isGlobalWorkspace ? "global-invoice-share" : "invoice-share";
  const body = isGlobalWorkspace
    ? { action:"create", workspace_id:workspaceId, invoice_id:invoiceId, expires_in_days:7 }
    : { action:"create", invoiceId };
  const { data, error } = await supabase.functions.invoke(functionName, { body });
  if (error) {
    let message = error.message || "Could not create invoice link.";
    try { const responseBody = await error.context?.clone?.().json(); if (responseBody?.error) message = responseBody.error; } catch {}
    throw new Error(message);
  }
  if (!data?.url) throw new Error(data?.error || "Could not create invoice link.");
  return data;
}
