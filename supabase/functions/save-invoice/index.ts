import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { calculateInvoiceGlobalTax } from "./_shared/tax/invoice-tax-integration.js";
import { resolveSupabaseTaxRule } from "../_shared/tax/supabase-tax-rule-resolver.ts";
import { isDraftTaxRulesAllowed } from "../_shared/tax/draft-tax-policy.mjs";
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
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !serviceRole) return json({ error: "Invoice service is not configured." }, 503, origin);
  try {
    const db = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    // The service client is used only for read-only lookup of shared tax rules,
    // after the caller and workspace have been authenticated above.
    const taxDb = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await db.auth.getUser();
    if (authError || !user) return json({ error: "Your session expired. Please sign in again." }, 401, origin);
    const body = await req.json().catch(() => ({}));
    if (!Array.isArray(body?.items) || body.items.length > 500) return json({ error: "Invalid invoice items." }, 400, origin);
    const { data: userProfile, error: userProfileError } = await db.from("profiles")
      .select("workspace_id").eq("id", user.id).maybeSingle();
    if (userProfileError || !userProfile?.workspace_id) return json({ error: "Workspace could not be verified." }, 403, origin);
    const [{ data: workspaceSettings, error: workspaceSettingsError }, { data: businessProfile, error: businessProfileError }] = await Promise.all([
      db.from("workspace_settings").select("country_code,currency_code,locale_code")
        .eq("workspace_id", userProfile.workspace_id).maybeSingle(),
      db.from("business_profile").select("tax_registration_number,tax_registration_type,tax_registration_status,tax_registration_effective_from,tax_jurisdiction_code")
        .eq("workspace_id", userProfile.workspace_id).maybeSingle(),
    ]);
    if (workspaceSettingsError || businessProfileError) return json({ error: "Workspace regional settings could not be verified." }, 500, origin);
    const countryCode = String(workspaceSettings?.country_code || "").trim().toUpperCase();
    const baseCurrencyCode = String(workspaceSettings?.currency_code || "").trim().toUpperCase();
    if (!countryCode || !/^[A-Z]{3}$/.test(baseCurrencyCode)) {
      return json({ error: "Choose and save your Workspace country before creating invoices. No country or currency default is assumed." }, 409, origin);
    }
    const requestedCountry = String(body?.invoice_snapshot?.workspaceCountryCode || body?.invoice_snapshot?.globalTax?.countryCode || "");
    if (requestedCountry && requestedCountry !== countryCode) return json({ error: "Invoice country does not match the manually selected Workspace country." }, 422, origin);
    const requestedCurrency = String(body?.currency || body?.invoice_snapshot?.currency || "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(requestedCurrency) || !["INR", "USD", "EUR", "GBP", "AED", "CAD", "AUD", "SGD"].includes(requestedCurrency)) {
      return json({ error: "Choose a supported invoice currency." }, 422, origin);
    }
    if (requestedCurrency !== baseCurrencyCode) {
      if (countryCode !== "IN") return json({ error: "Additional invoice currencies are not enabled for this Workspace country yet." }, 403, origin);
      const { data: accessStatus, error: accessError } = await db.rpc("get_access_status", { p_workspace_id: userProfile.workspace_id });
      if (accessError) return json({ error: "Additional currency access could not be verified." }, 503, origin);
      if (accessStatus?.features?.multi_currency !== true) {
        return json({ error: "Additional invoice currencies require the Pro multi-currency feature." }, 403, origin);
      }
    }
    let verifiedGlobalTaxResult: Record<string, unknown> | null = null;
    if (countryCode !== "IN") {
      if (body?.is_draft !== true && body?.issue_invoice !== true) {
        return json({ error: "Non-India invoices must be saved as drafts or issued through the verified commercial invoice workflow." }, 409, origin);
      }
      if (!body?.invoice_snapshot || typeof body.invoice_snapshot !== "object") {
        return json({ error: "Invoice draft details are required." }, 422, origin);
      }
      const taxInput = {
        ...body.invoice_snapshot,
        items: body.items,
        issueDate: body.issue_date || body.invoice_snapshot.issueDate,
        currency: body.currency || body.invoice_snapshot.currency,
        discount: body.discount ?? body.invoice_snapshot.discount,
        discountType: body.discount_type || body.invoice_snapshot.discountType,
      };
      const taxProfile = {
        countryCode,
        currencyCode: baseCurrencyCode,
        registrationNumber: businessProfile?.tax_registration_number || "",
        registrationType: businessProfile?.tax_registration_type || "",
        registrationStatus: businessProfile?.tax_registration_status || "unregistered",
        registrationEffectiveFrom: businessProfile?.tax_registration_effective_from || "",
        registeredJurisdiction: businessProfile?.tax_jurisdiction_code || "",
      };
      const taxConfig = taxInput.globalTax && typeof taxInput.globalTax === "object" ? taxInput.globalTax : {};
      const taxDate = String(taxInput.issueDate || "");
      const taxJurisdiction = countryCode === "CA"
        ? String(taxConfig.destinationJurisdiction?.province || "").trim().toUpperCase()
        : countryCode === "US"
          ? String(taxConfig.destinationJurisdiction?.state || "").trim().toUpperCase()
          : countryCode;
      const draftMode = isDraftTaxRulesAllowed(Deno.env.get("ALLOW_DRAFT_TAX_RULES"));
      const resolved = await resolveSupabaseTaxRule(taxDb, {
        countryCode, jurisdictionId: taxJurisdiction, invoiceDate: taxDate,
        treatment: String(taxConfig.taxTreatment || "standard").replace("standard-rated", "standard"),
        taxCode: typeof taxConfig.taxCode === "string" ? taxConfig.taxCode : null,
      }, draftMode);
      let taxResult: any;
      if (!resolved.ok) {
        taxResult = { ok:false, status:"needs_review", code:resolved.code, message:resolved.message };
      } else if (countryCode === "IN") {
        // India invoice totals continue through the existing GST split path.
        // The selected database rule is retained in the immutable invoice snapshot.
        taxResult = { ok:true, status:"india_legacy", countryCode, ruleSnapshot:resolved.rule, ruleMode:resolved.mode };
      } else {
        const components = resolved.rule.components;
        taxInput.globalTax = {
          ...taxConfig,
          countryCode,
          mode: "manual",
          resolvedRuleSource: "supabase",
          ruleMode: resolved.mode,
          taxMode: "taxable",
          taxTreatment: "standard",
          components,
        };
        taxResult = calculateInvoiceGlobalTax(taxInput, taxProfile);
        if (taxResult.ok) {
          taxResult.ruleSnapshot = {
            id: resolved.rule.id, version: resolved.rule.version,
            countryCode, jurisdictionId: resolved.rule.jurisdictionId,
            effectiveFrom: resolved.rule.effectiveFrom, effectiveTo: resolved.rule.effectiveTo,
            source: resolved.rule.source, status: resolved.rule.status,
            ruleMode: resolved.mode,
          };
          taxResult.status = resolved.mode === "draft_test" ? "draft_test" : taxResult.status;
          taxResult.warning = resolved.mode === "draft_test"
            ? "Calculated using a draft baseline rule for testing only; not legally verified and not for production issuance."
            : taxResult.warning;
        }
      }
      if (taxResult.ok === true && countryCode !== "IN") verifiedGlobalTaxResult = taxResult as unknown as Record<string, unknown>;
      body.invoice_snapshot = {
        ...taxInput,
        documentType: "draft_invoice",
        documentStatus: "draft",
        document_type: "draft_invoice",
        document_status: "draft",
        country_code: countryCode,
        currency_code: requestedCurrency,
        globalTaxCalculation: { ...taxResult, countryCode },
        globalTaxProfileSnapshot: {
          countryCode,
          registrationNumber: businessProfile?.tax_registration_number || "",
          registrationType: businessProfile?.tax_registration_type || "",
          registrationStatus: businessProfile?.tax_registration_status || "unregistered",
          registrationEffectiveFrom: businessProfile?.tax_registration_effective_from || "",
          registeredJurisdiction: businessProfile?.tax_jurisdiction_code || "",
        },
      };
      // Drafts can be saved for review even when a tax rule is not yet verified.
      // No unverified tax amount is added to the server-side ledger.
      body.tax_rate = 0;
      body.tax_mode = "split";
    }
    if (countryCode === "IN" && body?.invoice_snapshot && typeof body.invoice_snapshot === "object") {
      // Preserve the established India GST ledger path, while binding each
      // selected GST slab to its versioned Supabase baseline rule.
      const rates: number[] = [...new Set<number>((body.items || []).filter((item: any) => item?.gst_rate !== null && item?.gst_rate !== undefined && item?.gst_rate !== "")
        .map((item: any) => Number(item.gst_rate)).filter((rate: number) => Number.isFinite(rate) && rate >= 0 && rate <= 100))];
      const snapshots: any[] = [];
      const resolvedRateByPercent = new Map<number, any>();
      for (const rate of rates) {
        const taxCode = "GST_" + String(rate).replace(/\\.0+$/, "");
        const treatment = rate === 0 ? "zero-rated" : rate === 5 ? "reduced" : "standard";
        const resolved = await resolveSupabaseTaxRule(taxDb, {
          countryCode:"IN", jurisdictionId:"IN", invoiceDate:String(body.issue_date || body.invoice_snapshot.issueDate || ""),
          treatment, taxCode,
        }, isDraftTaxRulesAllowed(Deno.env.get("ALLOW_DRAFT_TAX_RULES")));
        if (!resolved.ok) return json({ error:"The selected India GST slab has no effective Supabase rule: " + taxCode },422,origin);
        const resolvedRateBps = resolved.rule.components.reduce((sum:number,component:any)=>sum+Number(component.rateBps),0);
        resolvedRateByPercent.set(rate, { rate:resolvedRateBps / 100, rule:resolved.rule, mode:resolved.mode });
        snapshots.push({
          taxCode, treatment, status:resolved.mode, ruleId:resolved.rule.id,
          version:resolved.rule.version, effectiveFrom:resolved.rule.effectiveFrom,
          source:resolved.rule.source, components:resolved.rule.components,
        });
      }
      body.items = (body.items || []).map((item:any) => {
        if (item?.gst_rate === null || item?.gst_rate === undefined || item?.gst_rate === "") return item;
        const selected = resolvedRateByPercent.get(Number(item.gst_rate));
        return selected ? { ...item, gst_rate:selected.rate } : item;
      });
      const taxConfig = body.invoice_snapshot.globalTax && typeof body.invoice_snapshot.globalTax === "object"
        ? body.invoice_snapshot.globalTax : {};
      const explicitSupplyType = String(taxConfig.indiaSupplyType || taxConfig.supplyType || "").toUpperCase();
      const sellerState = String(businessProfile?.tax_jurisdiction_code || "").replace(/^IN[-_]/i,"").trim().toUpperCase();
      const placeState = String(taxConfig.placeOfSupplyState || taxConfig.placeOfSupply || "").replace(/^IN[-_]/i,"").trim().toUpperCase();
      const supplyType = ["INTRA","INTER"].includes(explicitSupplyType) ? explicitSupplyType
        : /^(?:[0-9]{2}|[A-Z]{2})$/.test(sellerState) && /^(?:[0-9]{2}|[A-Z]{2})$/.test(placeState) ? (sellerState === placeState ? "INTRA" : "INTER") : null;
      if (supplyType) body.tax_mode = supplyType === "INTRA" ? "split" : "igst";
      body.invoice_snapshot = {
        ...body.invoice_snapshot,
        country_code:"IN",
        indiaTaxRuleSnapshots:snapshots,
        indiaSupplyType:supplyType,
        indiaTaxMode:supplyType === "INTRA" ? "CGST+SGST" : supplyType === "INTER" ? "IGST" : null,
        indiaTaxRuleMode:!snapshots.length ? "unresolved" : snapshots.some((rule)=>rule.status === "draft_test") ? "draft_test" : "verified",
      };
    }
    const invoiceId = body.invoiceId ?? body.id ?? null;
    if (invoiceId !== null && (typeof invoiceId !== "string" || !/^[0-9a-f-]{36}$/i.test(invoiceId))) return json({ error: "Invalid invoice id." }, 400, origin);
    if (invoiceId !== null) {
      const { data: existingInvoice, error: existingInvoiceError } = await db.from("invoices")
        .select("id,is_draft,issue_request_key").eq("id", invoiceId).eq("workspace_id", userProfile.workspace_id).maybeSingle();
      if (existingInvoiceError) return json({ error: "Existing invoice could not be checked." }, 500, origin);
      if (!existingInvoice) return json({ error: "Invoice not found in this workspace." }, 404, origin);
      if (existingInvoice.is_draft !== true && !(body?.issue_invoice === true && existingInvoice.issue_request_key === body?.issue_idempotency_key)) {
        return json({ error: "Only draft invoices can be edited from this workflow." }, 409, origin);
      }
    }
    const { items, id, invoiceId: _ignored, issue_invoice: _issueInvoice, issue_idempotency_key: _issueKey, ...data } = body;
    const isNonIndiaInvoice = countryCode !== "IN";
    const safeItems = items.map((it: Record<string, unknown>) => ({
      description: typeof it?.description === "string" ? it.description.slice(0, 500) : "",
      quantity: Number.isFinite(Number(it?.quantity)) ? Math.max(0, Number(it.quantity)) : 0,
      rate: Number.isFinite(Number(it?.rate)) ? Math.max(0, Number(it.rate)) : 0,
      ...(!isNonIndiaInvoice && it?.gst_rate !== undefined && it?.gst_rate !== null && it?.gst_rate !== ""
        ? { gst_rate: Number.isFinite(Number(it.gst_rate)) ? Math.max(0, Number(it.gst_rate)) : 0 }
        : {}),
      ...(!isNonIndiaInvoice && typeof it?.hsn_sac_code === "string" && /^[0-9]{4,8}$/.test(it.hsn_sac_code)
        ? { hsn_sac_code: it.hsn_sac_code }
        : {}),
      ...(!isNonIndiaInvoice ? { unit_code: typeof it?.unit_code === "string" && /^[A-Z0-9]{2,8}$/.test(it.unit_code) ? it.unit_code : "OTH" } : {}),
    }));
    let saved: any = null;
    let issueError: { code?: string; message?: string } | null = null;
    if (isNonIndiaInvoice && body?.issue_invoice === true) {
      const calculation = body?.invoice_snapshot?.globalTaxCalculation;
      if (calculation?.ok !== true || calculation?.status !== "not_applicable") {
        return json({ error: "This release can issue commercial invoices only after explicit no-tax confirmation. Tax invoices remain gated until their country adapter is verified." }, 409, origin);
      }
      const { data: issuedResult, error } = await db.rpc("save_and_issue_commercial_invoice", {
        _data: data, _items: safeItems, _idempotency_key: body.issue_idempotency_key, _invoice_id: invoiceId,
      });
      issueError = error;
      if (!error && issuedResult?.invoice?.id) saved = issuedResult.invoice;
    } else {
      const { data: savedDraft, error } = await db.rpc("save_invoice", { _data: data, _items: safeItems, _invoice_id: invoiceId });
      issueError = error;
      if (!error && savedDraft?.id) saved = savedDraft;
    }
    if (issueError || !saved?.id) {
      const status = issueError?.code === "42501" ? 403 : issueError?.code === "P0002" ? 404 : 400;
      return json({ error: issueError?.message || "Could not save invoice." }, status, origin);
    }

    // Keep non-India invoice drafts connected to the canonical CRM customer record.
    if (countryCode !== "IN" && body?.issue_invoice !== true) {
      const client = body?.invoice_snapshot?.client && typeof body.invoice_snapshot.client === "object"
        ? body.invoice_snapshot.client : {};
      const clientName = String(body.client_name || client.name || client.company || "").trim().slice(0, 160);
      const clientEmail = String(body.client_email || client.email || "").trim().toLowerCase().slice(0, 254);
      const clientPhone = String(client.phone || "").trim().slice(0, 40);
      if (clientName) {
        let clientId: string | null = null;
        let clientQuery = db.from("clients").select("id").eq("workspace_id", userProfile.workspace_id);
        if (clientEmail) clientQuery = clientQuery.eq("email", clientEmail);
        else if (clientPhone) clientQuery = clientQuery.eq("phone", clientPhone).eq("name", clientName);
        else clientQuery = clientQuery.eq("name", clientName);
        const { data: existingClient, error: clientLookupError } = await clientQuery.limit(1).maybeSingle();
        if (clientLookupError) return json({ error: "Customer record could not be checked. The invoice remains a draft." }, 500, origin);
        clientId = existingClient?.id || null;
        if (!clientId) {
          const { data: createdClient, error: clientCreateError } = await db.from("clients").insert({
            workspace_id: userProfile.workspace_id,
            name: clientName,
            email: clientEmail || null,
            phone: clientPhone || null,
            gstin: String(client.gstin || "").trim().slice(0, 80) || null,
            address: String(client.address || "").trim().slice(0, 1000),
          }).select("id").single();
          if (clientCreateError || !createdClient?.id) return json({ error: "Customer record could not be saved. The invoice remains a draft." }, 500, origin);
          clientId = createdClient.id;
        }
        const { error: linkClientError } = await db.from("invoices").update({ client_id: clientId })
          .eq("id", saved.id).eq("workspace_id", userProfile.workspace_id).eq("is_draft", true);
        if (linkClientError) return json({ error: "Invoice draft saved, but its customer link could not be synchronized." }, 500, origin);
      }
    }

    if (isNonIndiaInvoice && body?.issue_invoice !== true && body?.invoice_snapshot) {
      const { error: snapshotError } = await db.from("invoices").update({
        invoice_snapshot: body.invoice_snapshot,
      }).eq("id", saved.id).eq("workspace_id", userProfile.workspace_id).eq("is_draft", true);
      if (snapshotError) return json({ error: "Draft saved, but its invoice snapshot could not be synchronized." }, 500, origin);
    }

    if (verifiedGlobalTaxResult && !(isNonIndiaInvoice && body?.issue_invoice === true)) {
      const taxMinor = Number(verifiedGlobalTaxResult.taxMinor);
      const totalMinor = Number(verifiedGlobalTaxResult.totalMinor);
      if (!Number.isSafeInteger(taxMinor) || !Number.isSafeInteger(totalMinor) || taxMinor < 0 || totalMinor < 0) {
        return json({ error: "The verified tax result could not be safely stored. The invoice remains a draft." }, 422, origin);
      }
      const { error: totalsError } = await db.from("invoices").update({
        tax_value: taxMinor / 100,
        total: totalMinor / 100,
        cgst: 0,
        sgst: 0,
        igst: 0,
        invoice_snapshot: body.invoice_snapshot,
      }).eq("id", saved.id).eq("workspace_id", userProfile.workspace_id).eq("is_draft", true);
      if (totalsError) return json({ error: "Draft saved, but verified tax totals could not be synchronized. Please retry." }, 500, origin);
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
