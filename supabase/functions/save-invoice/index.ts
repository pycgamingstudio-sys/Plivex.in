import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { calculateInvoiceGlobalTax } from "../../../src/global/tax/invoice-tax-integration.js";
const ORIGINS = new Set(["https://plivex.in", "https://www.plivex.in", "https://plivex.netlify.app"]);
const allowed = (o: string | null) => !o || ORIGINS.has(o) || /^https:\/\/(?:[a-z0-9-]+\.)?[a-z0-9-]+\.(?:pages|workers)\.dev$/.test(o);
const cors = (o: string | null) => ({ "Access-Control-Allow-Origin": o && allowed(o) ? o : "https://plivex.in", "Vary": "Origin", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" });
const json = (b: unknown, s: number, o: string | null) => new Response(JSON.stringify(b), { status: s, headers: { ...cors(o), "Content-Type": "application/json", "Cache-Control": "no-store" } });
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!allowed(origin)) return json({ error: "Origin not allowed" }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Please sign in." }, 401, origin);
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) return json({ error: "Invoice service is not configured." }, 503, origin);
  try {
    const db = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await db.auth.getUser();
    if (authError || !user) return json({ error: "Your session expired. Please sign in again." }, 401, origin);
    const body = await req.json().catch(() => ({}));
    if (!Array.isArray(body?.items) || body.items.length > 500) return json({ error: "Invalid invoice items." }, 400, origin);
    const { data: userProfile, error: userProfileError } = await db.from("profiles")
      .select("workspace_id").eq("id", user.id).maybeSingle();
    if (userProfileError || !userProfile?.workspace_id) return json({ error: "Workspace could not be verified." }, 403, origin);
    const { data: businessProfile, error: businessProfileError } = await db.from("business_profile")
      .select("country_code,tax_registration_number,tax_registration_type,tax_registration_status,tax_registration_effective_from,tax_jurisdiction_code")
      .eq("workspace_id", userProfile.workspace_id).maybeSingle();
    if (businessProfileError) return json({ error: "Workspace tax profile could not be loaded." }, 500, origin);
    const countryCode = String(businessProfile?.country_code || "IN").toUpperCase();
    const requestedCountry = String(body?.invoice_snapshot?.globalTax?.countryCode || "");
    if (requestedCountry && requestedCountry !== countryCode) return json({ error: "Invoice tax country does not match the saved workspace country." }, 422, origin);
    if (countryCode !== "IN") {
      if (!businessProfile || !body?.invoice_snapshot || typeof body.invoice_snapshot !== "object") {
        return json({ error: "A saved workspace tax profile and invoice tax details are required." }, 422, origin);
      }
      const taxInput = {
        ...body.invoice_snapshot,
        items: body.items,
        issueDate: body.issue_date || body.invoice_snapshot.issueDate,
        currency: body.currency || body.invoice_snapshot.currency,
        discount: body.discount ?? body.invoice_snapshot.discount,
        discountType: body.discount_type || body.invoice_snapshot.discountType,
      };
      const currencyByCountry: Record<string, string> = { US: "USD", GB: "GBP", AE: "AED", CA: "CAD", AU: "AUD", SG: "SGD" };
      const taxResult = calculateInvoiceGlobalTax(taxInput, {
        countryCode,
        currencyCode: currencyByCountry[countryCode] || "",
        registrationNumber: businessProfile.tax_registration_number || "",
        registrationType: businessProfile.tax_registration_type || "",
        registrationStatus: businessProfile.tax_registration_status || "unregistered",
        registrationEffectiveFrom: businessProfile.tax_registration_effective_from || "",
        registeredJurisdiction: businessProfile.tax_jurisdiction_code || "",
      });
      if (taxResult.ok !== true) return json({ error: "message" in taxResult ? taxResult.message : "Global tax calculation could not be completed.", code: "code" in taxResult ? taxResult.code : "TAX_CALCULATION_FAILED", taxStatus: taxResult.status }, 422, origin);
      body.invoice_snapshot = {
        ...taxInput,
        globalTaxCalculation: taxResult,
        globalTaxProfileSnapshot: {
          countryCode,
          registrationNumber: businessProfile.tax_registration_number || "",
          registrationType: businessProfile.tax_registration_type || "",
          registrationStatus: businessProfile.tax_registration_status || "unregistered",
          registrationEffectiveFrom: businessProfile.tax_registration_effective_from || "",
          registeredJurisdiction: businessProfile.tax_jurisdiction_code || "",
        },
      };
      body.tax_rate = 0;
      body.tax_mode = "split";
    }
    const invoiceId = body.invoiceId ?? body.id ?? null;
    if (invoiceId !== null && (typeof invoiceId !== "string" || !/^[0-9a-f-]{36}$/i.test(invoiceId))) return json({ error: "Invalid invoice id." }, 400, origin);
    if (invoiceId !== null) {
      const { data: existingInvoice, error: existingInvoiceError } = await db.from("invoices")
        .select("id,is_draft").eq("id", invoiceId).eq("workspace_id", userProfile.workspace_id).maybeSingle();
      if (existingInvoiceError) return json({ error: "Existing invoice could not be checked." }, 500, origin);
      if (!existingInvoice) return json({ error: "Invoice not found in this workspace." }, 404, origin);
      if (existingInvoice.is_draft !== true) return json({ error: "Only draft invoices can be edited from this workflow." }, 409, origin);
    }
    const { items, id, invoiceId: _ignored, ...data } = body;
    const isGlobalInvoice = String(body?.invoice_snapshot?.globalTaxCalculation?.countryCode || "").toUpperCase() !== "" &&
      String(body?.invoice_snapshot?.globalTaxCalculation?.countryCode || "").toUpperCase() !== "IN";
    const safeItems = items.map((it: Record<string, unknown>) => ({
      description: typeof it?.description === "string" ? it.description.slice(0, 500) : "",
      quantity: Number.isFinite(Number(it?.quantity)) ? Math.max(0, Number(it.quantity)) : 0,
      rate: Number.isFinite(Number(it?.rate)) ? Math.max(0, Number(it.rate)) : 0,
      ...(!isGlobalInvoice && it?.gst_rate !== undefined && it?.gst_rate !== null && it?.gst_rate !== ""
        ? { gst_rate: Number.isFinite(Number(it.gst_rate)) ? Math.max(0, Number(it.gst_rate)) : 0 }
        : {}),
    }));
    const { data: saved, error } = await db.rpc("save_invoice", { _data: data, _items: safeItems, _invoice_id: invoiceId });
    if (error || !saved?.id) {
      const status = error?.code === "42501" ? 403 : error?.code === "P0002" ? 404 : 400;
      return json({ error: error?.message || "Could not save invoice." }, status, origin);
    }
    const { data: invoice, error: readError } = await db.from("invoices").select("*,invoice_items(*)")
      .eq("id", saved.id).maybeSingle();
    if (readError || !invoice) return json({ error: "Invoice saved but could not be reloaded." }, 500, origin);
    return json({ invoice }, 200, origin);
  } catch (error) {
    console.error("save-invoice failed", error);
    return json({ error: "Something went wrong while saving the invoice." }, 500, origin);
  }
});
