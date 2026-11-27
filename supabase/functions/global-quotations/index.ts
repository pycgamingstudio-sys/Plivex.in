import { authenticateGlobal, globalCorsHeaders, globalJson, isGlobalOriginAllowed } from "../_shared/global.ts";
import { resolveSupabaseTaxRule } from "../_shared/tax/supabase-tax-rule-resolver.ts";
import { isDraftTaxRulesAllowed } from "../_shared/tax/draft-tax-policy.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const validDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
};

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!isGlobalOriginAllowed(origin)) return globalJson({ error: "Origin not allowed" }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: globalCorsHeaders(origin) });
  if (req.method !== "POST") return globalJson({ error: "Method not allowed" }, 405, origin);

  const auth = await authenticateGlobal(req);
  if ("error" in auth) return globalJson({ error: auth.error }, auth.status, origin);

  // Tax computation and the RPC are server-side only. The authenticated
  // user and active workspace membership are verified above; the database
  // overload is service-role-only and rechecks the supplied member identity.


  try {
    const declaredLength = Number(req.headers.get("content-length") || 0);
    if (declaredLength > 64 * 1024) return globalJson({ error: "Request is too large." }, 413, origin);
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > 64 * 1024) return globalJson({ error: "Request is too large." }, 413, origin);
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { return globalJson({ error: "Invalid JSON request." }, 400, origin); }
    if (!isObject(body) || !["list", "create", "status", "convert"].includes(String(body.action))) {
      return globalJson({ error: "Unsupported quotation request." }, 400, origin);
    }

    const action = String(body.action);
    if (typeof body.workspace_id !== "string" || !UUID.test(body.workspace_id)) {
      return globalJson({ error: "A valid Global workspace is required." }, 400, origin);
    }

    const { data: membership, error: membershipError } = await auth.admin.schema("global").from("workspace_members")
      .select("role").eq("workspace_id", body.workspace_id).eq("user_id", auth.user.id)
      .eq("status", "active").maybeSingle();
    if (membershipError) return globalJson({ error: "Workspace membership could not be verified." }, 503, origin);
    if (!membership) return globalJson({ error: "You do not have access to this workspace." }, 403, origin);
    if (action === "create") {
      if (typeof body.idempotency_key !== "string" || !UUID.test(body.idempotency_key)
        || typeof body.currency_code !== "string" || !/^[A-Z]{3}$/.test(body.currency_code)
        || !validDate(body.issue_date)
        || (body.valid_until !== null && body.valid_until !== undefined && !validDate(body.valid_until))
        || (body.client_id !== null && body.client_id !== undefined && (typeof body.client_id !== "string" || !UUID.test(body.client_id)))
        || (body.notes !== null && body.notes !== undefined && (typeof body.notes !== "string" || body.notes.length > 4000))
        || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100) {
        return globalJson({ error: "Quotation details are invalid. Check the customer, dates and line items." }, 400, origin);
      }
      for (const [index, item] of body.items.entries()) {
        if (!isObject(item) || typeof item.description !== "string" || !item.description.trim() || item.description.length > 500
          || !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0 || Number(item.quantity) > 1_000_000
          || Math.round(Number(item.quantity) * 10000) !== Number(item.quantity) * 10000
          || typeof item.unit_price_minor !== "number" || !Number.isSafeInteger(item.unit_price_minor) || item.unit_price_minor < 0
          || (item.discount_minor !== undefined && (!Number.isSafeInteger(item.discount_minor) || Number(item.discount_minor) < 0))) {
          return globalJson({ error: `Quotation line ${index + 1} has invalid values.` }, 400, origin);
        }
      }
    }
    if (["status", "convert"].includes(action) && (typeof body.quotation_id !== "string" || !UUID.test(body.quotation_id))) {
      return globalJson({ error: "A valid quotation is required." }, 400, origin);
    }
    if (action === "status" && !["sent", "accepted", "rejected", "expired"].includes(String(body.status))) {
      return globalJson({ error: "Choose a valid quotation status." }, 400, origin);
    }


    const quotationItems = Array.isArray(body.items) ? body.items as Array<Record<string, unknown>> : [];
    let taxMinor = 0;
    let taxSnapshot: Record<string, unknown> | null = null;
    if (action === "create") {
      const { data: workspace, error: workspaceError } = await auth.admin.schema("global").from("workspaces")
        .select("country_code,currency_code").eq("id", body.workspace_id).maybeSingle();
      if (workspaceError || !workspace) return globalJson({ error:"Workspace country could not be verified." },403,origin);
      const countryCode = String(workspace.country_code || "").toUpperCase();
      const currencyCode = String(workspace.currency_code || "").toUpperCase();
      if (!["IN","US","GB","AE","CA","AU","SG"].includes(countryCode) || body.currency_code !== currencyCode) {
        return globalJson({ error:"Quotation country and currency must match the saved Workspace settings." },422,origin);
      }
      const taxCode = String(body.tax_code || "").trim();
      const jurisdictionId = countryCode === "US" || countryCode === "CA"
        ? String(body.tax_jurisdiction_id || "").trim().toUpperCase()
        : countryCode === "IN" ? "IN" : countryCode;
      if ((countryCode === "US" || countryCode === "CA") && !jurisdictionId) {
        return globalJson({ error:"Select the destination state or province for this quotation." },422,origin);
      }
      const resolved = await resolveSupabaseTaxRule(auth.admin, {
        countryCode, jurisdictionId, invoiceDate:String(body.issue_date),
        treatment:String(body.tax_treatment || (taxCode === "GST_0" ? "zero-rated" : taxCode === "GST_5" ? "reduced" : "standard")), taxCode:taxCode || null,
      }, isDraftTaxRulesAllowed(Deno.env.get("ALLOW_DRAFT_TAX_RULES")));
      if (!resolved.ok) return globalJson({ error:resolved.message || "No effective workspace tax rule is available.", code:resolved.code },422,origin);

      let components = resolved.rule.components;
      if (countryCode === "IN") {
        const split = String(body.india_supply_type || "").toUpperCase();
        const rateBps = components.reduce((sum: number, component: any)=>sum+component.rateBps,0);
        if (split === "INTRA") {
          if (rateBps % 2 !== 0) return globalJson({error:"This GST rate cannot be split evenly into CGST and SGST."},422,origin);
          components = [
            {id:"CGST",name:"CGST",rateBps:rateBps/2,source:resolved.rule.source},
            {id:"SGST",name:"SGST",rateBps:rateBps/2,source:resolved.rule.source},
          ];
        } else if (split === "INTER") {
          components = [{id:"IGST",name:"IGST",rateBps,source:resolved.rule.source}];
        } else return globalJson({error:"Choose same-state (CGST + SGST) or inter-state (IGST) supply."},422,origin);
      }
      const subtotal = quotationItems.reduce((sum:number,item:any)=>sum + Math.round(Number(item.quantity)*Number(item.unit_price_minor)),0);
      const discount = quotationItems.reduce((sum:number,item:any)=>sum + Number(item.discount_minor || 0),0);
      const taxable = Math.max(0,subtotal-discount);
      if (!Number.isSafeInteger(taxable)) return globalJson({error:"Quotation taxable amount is outside supported limits."},422,origin);
      const totalRateBps = components.reduce((sum:number,component:any)=>sum+component.rateBps,0);
      taxMinor = components.reduce((sum:number,component:any)=>sum + Math.floor((taxable*component.rateBps+5000)/10000),0);
      if (!Number.isSafeInteger(taxMinor) || taxMinor < 0 || taxMinor > 9000000000000000) return globalJson({error:"Quotation tax exceeds supported limits."},422,origin);
      taxSnapshot = {
        countryCode,currencyCode,jurisdictionId,ruleId:resolved.rule.id,version:resolved.rule.version,
        effectiveFrom:resolved.rule.effectiveFrom,effectiveTo:resolved.rule.effectiveTo,
        treatment:resolved.rule.treatment,components,status:resolved.mode,
        taxMinor,taxableMinor:taxable,totalRateBps,source:resolved.rule.source,
        calculatedAt:new Date().toISOString(),
        warning:resolved.mode === "draft_test"
          ? (countryCode === "US"
            ? "Draft-test state baseline only; not legally verified and excludes local city, county and special-district taxes."
            : "Draft baseline rule for testing only; not legally verified.")
          : countryCode === "US" ? "State-level baseline only; local city, county and special-district taxes are not included."
          : countryCode === "CA" ? "Provincial baseline components only; product-specific place-of-supply exceptions may apply." : null,
        indiaSupplyType:countryCode === "IN" ? body.india_supply_type : null,
      };
    }

    const { data, error } = await auth.admin.rpc("global_manage_quotation", {
      p_user_id: auth.user.id,
      p_workspace_id: body.workspace_id,
      p_action: action,
      p_quotation_id: body.quotation_id || null,
      p_client_id: body.client_id || null,
      p_currency_code: body.currency_code || null,
      p_issue_date: body.issue_date || null,
      p_valid_until: body.valid_until || null,
      p_notes: body.notes || null,
      p_items: Array.isArray(body.items) ? body.items : [],
      p_status: body.status || null,
      p_idempotency_key: body.idempotency_key || null,
      p_tax_minor: action === "create" ? taxMinor : null,
      p_tax_snapshot: action === "create" ? taxSnapshot : null,
    });
    if (error) {
      console.error("Global quotation RPC failed", { code: error.code });
      return globalJson({ error: "Quotation service is temporarily unavailable. Please try again later." }, 503, origin);
    }
    if (!data?.ok) {
      const reason = String(data?.reason || "request_failed");
      const messages: Record<string, string> = {
        access_denied: "You do not have access to this Global workspace.",
        forbidden: "Your workspace role cannot perform this quotation action.",
        invalid_currency: "Quotation currency must match your workspace currency.",
        client_not_found: "The selected customer is not active in this workspace.",
        quotation_not_found: "Quotation not found.",
        quotation_closed: "This quotation is already closed.",
        invalid_transition: "That status change is not allowed.",
        quotation_not_accepted: "Mark the quotation as accepted before converting it.",
        invoice_conversion_failed: "The invoice draft could not be created. The quotation remains unchanged.",
        invalid_quotation: "Quotation details or dates are invalid.",
        invalid_item_values: "A quotation line has invalid values.",
        invalid_item_discount: "A line discount cannot exceed its line amount.",
        quotation_total_limit: "The quotation total exceeds the supported limit.",
      };
      const status = ["access_denied", "forbidden"].includes(reason) ? 403
        : reason === "quotation_not_found" ? 404
        : ["quotation_closed", "invalid_transition", "quotation_not_accepted"].includes(reason) ? 409 : 400;
      return globalJson({ error: messages[reason] || "Could not complete the quotation request.", reason }, status, origin);
    }
    return globalJson(data, action === "create" ? 201 : 200, origin);
  } catch (error) {
    console.error("global-quotations failed", error);
    return globalJson({ error: "Something went wrong with the Global quotation request." }, 500, origin);
  }
});
