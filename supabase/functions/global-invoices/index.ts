import { authenticateGlobal, globalCorsHeaders, globalJson, isGlobalOriginAllowed } from "../_shared/global.ts";
import { resolveSupabaseTaxRule } from "../_shared/tax/supabase-tax-rule-resolver.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BODY_BYTES = 64 * 1024;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const parsed = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
function statusFor(reason: string): number {
  if (reason === "access_denied" || reason === "forbidden") return 403;
  if (reason === "client_not_found" || reason === "product_not_found" || reason === "invoice_not_found") return 404;
  if (reason === "idempotency_conflict" || reason === "overpayment" || reason === "invoice_not_payable") return 409;
  return 400;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!isGlobalOriginAllowed(origin)) return globalJson({ error: "Origin not allowed" }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: globalCorsHeaders(origin) });
  if (req.method !== "POST") return globalJson({ error: "Method not allowed" }, 405, origin);

  const auth = await authenticateGlobal(req);
  if ("error" in auth) return globalJson({ error: auth.error }, auth.status, origin);

  try {
    const declaredLength = Number(req.headers.get("content-length") || 0);
    if (declaredLength > MAX_BODY_BYTES) return globalJson({ error: "Request is too large." }, 413, origin);
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return globalJson({ error: "Request is too large." }, 413, origin);
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { return globalJson({ error: "Invalid JSON request." }, 400, origin); }
    if (!isObject(body)) return globalJson({ error: "Invalid request body." }, 400, origin);

    const workspaceId = body.workspace_id;
    if (typeof workspaceId !== "string" || !UUID.test(workspaceId)) {
      return globalJson({ error: "A valid Global workspace_id is required." }, 400, origin);
    }

    if (body.action === "create_draft" || body.action === "create_final_commercial" || body.action === "create_final_tax") {
      if (body.client_id !== null && body.client_id !== undefined && (typeof body.client_id !== "string" || !UUID.test(body.client_id))) {
        return globalJson({ error: "Choose a valid client." }, 400, origin);
      }
      if (typeof body.idempotency_key !== "string" || !UUID.test(body.idempotency_key)) return globalJson({ error: "A valid invoice request id is required." }, 400, origin);
      if (typeof body.currency_code !== "string" || !/^[A-Z]{3}$/.test(body.currency_code)) {
        return globalJson({ error: "A valid workspace currency is required." }, 400, origin);
      }
      if (!validDate(body.issue_date) || (body.due_date !== null && body.due_date !== undefined && !validDate(body.due_date))) {
        return globalJson({ error: "Enter valid invoice and due dates." }, 400, origin);
      }
      if (typeof body.notes === "string" && body.notes.length > 4000) return globalJson({ error: "Notes are too long." }, 400, origin);
      if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100) {
        return globalJson({ error: "Add between 1 and 100 invoice lines." }, 400, origin);
      }
      const items = [];
      for (const [index, item] of body.items.entries()) {
        if (!isObject(item)) return globalJson({ error: `Invoice line ${index + 1} is invalid.` }, 400, origin);
        const quantity = Number(item.quantity);
        const unitPrice = item.unit_price_minor;
        const discount = item.discount_minor ?? 0;
        if (typeof item.description !== "string" || !item.description.trim() || item.description.length > 500
          || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000 || Math.round(quantity * 10000) !== quantity * 10000
          || typeof unitPrice !== "number" || !Number.isSafeInteger(unitPrice) || unitPrice < 0 || unitPrice > 9_000_000_000_000_000
          || typeof discount !== "number" || !Number.isSafeInteger(discount) || discount < 0 || discount > 9_000_000_000_000_000
          || (item.product_id !== null && item.product_id !== undefined && (typeof item.product_id !== "string" || !UUID.test(item.product_id)))) {
          return globalJson({ error: `Invoice line ${index + 1} has invalid values.` }, 400, origin);
        }
        items.push({
          description: item.description.trim(),
          quantity,
          unit_price_minor: unitPrice,
          discount_minor: discount,
          product_id: item.product_id || null,
        });
      }
      if (body.action === "create_final_tax") {
        const tax = body.tax_context;
        if (!isObject(tax)
          || typeof tax.registration_confirmed !== "boolean"
          || typeof tax.place_of_supply_confirmed !== "boolean"
          || typeof tax.tax_category_confirmed !== "boolean"
          || typeof tax.tax_category !== "string"
          || typeof tax.mode !== "string"
          || typeof tax.price_mode !== "string"
          || typeof tax.place_of_supply !== "string") {
          return globalJson({ error: "Required tax evidence is incomplete." }, 400, origin);
        }
      }
      const rpcName = body.action === "create_final_commercial"
        ? "global_create_and_issue_commercial_invoice"
        : body.action === "create_final_tax"
          ? "global_create_and_issue_tax_invoice"
          : "global_create_invoice_draft";
      const rpcArgs: Record<string, unknown> = {
        p_user_id: auth.user.id,
        p_workspace_id: workspaceId,
        p_client_id: body.client_id || null,
        p_currency_code: body.currency_code,
        p_issue_date: body.issue_date,
        p_due_date: body.due_date || null,
        p_notes: typeof body.notes === "string" ? body.notes.trim() || null : null,
        p_items: items,
        p_idempotency_key: body.idempotency_key,
      };
      if (body.action === "create_final_tax") rpcArgs.p_tax_context = body.tax_context;
      const { data, error } = await auth.admin.rpc(rpcName, rpcArgs);
      if (error) {
        console.error("Global invoice creation RPC failed", { code: error.code, action: body.action });
        return globalJson({ error: "Invoice creation service is not ready. Please try again later." }, 503, origin);
      }
      if (!data?.ok) {
        const reason = String(data?.reason || "request_failed");
        const messages: Record<string, string> = {
          access_denied: "You do not have access to this Global workspace.",
          forbidden: "Your workspace role cannot create invoices.",
          invalid_currency: "Invoice currency must match the workspace currency.",
          idempotency_conflict: "This request ID was already used for a different draft invoice.",
          invalid_dates: "Invoice dates are invalid.",
          invalid_items: "Invoice lines are invalid.",
          invalid_item_values: "An invoice line has invalid values.",
          invalid_item_discount: "A line discount cannot exceed its line amount.",
          invoice_total_limit: "The invoice total exceeds the supported limit.",
          client_not_found: "The selected client is not active in this workspace.",
          product_not_found: "The selected product is not active in this workspace.",
        };
        return globalJson({ error: messages[reason] || (body.action === "create_final_tax" ? "Could not issue the tax invoice." : body.action === "create_final_commercial" ? "Could not issue the commercial invoice." : "Could not create the draft invoice."), reason }, statusFor(reason), origin);
      }
      if (body.action === "create_draft" && isObject(body.tax_context)) {
        const { data: workspace, error: workspaceError } = await auth.admin.schema("global").from("workspaces")
          .select("country_code,currency_code").eq("id",workspaceId).maybeSingle();
        if (workspaceError || !workspace) return globalJson({error:"Workspace country could not be verified."},403,origin);
        const countryCode = String(workspace.country_code || "").toUpperCase();
        const currencyCode = String(workspace.currency_code || "").toUpperCase();
        if (body.currency_code !== currencyCode || !["US","GB","AE","CA","AU","SG"].includes(countryCode)) {
          return globalJson({error:"Invoice country and currency must match the saved Workspace settings."},422,origin);
        }
        const tax = body.tax_context;
        let taxMinor = 0;
        let taxSnapshot: Record<string, unknown>;
        if (tax.tax_mode === "no_tax") {
          if (tax.no_tax_confirmed !== true) return globalJson({error:"Confirm that no tax is chargeable before saving a commercial invoice draft."},422,origin);
          taxSnapshot = {
            countryCode,currencyCode,status:"not_assessed",taxMinor:0,
            warning:"No tax was assessed based on the business's explicit confirmation; this is not a tax-exempt or zero-rated classification.",
            calculatedAt:new Date().toISOString(),
          };
        } else {
          const jurisdictionId = countryCode === "CA" ? String(tax.destination_jurisdiction?.province || "").toUpperCase()
            : countryCode === "US" ? String(tax.destination_jurisdiction?.state || "").toUpperCase() : countryCode;
          if ((countryCode === "US" || countryCode === "CA") && !jurisdictionId) {
            return globalJson({error:"Select the destination state or province before calculating tax."},422,origin);
          }
          const resolved = await resolveSupabaseTaxRule(auth.admin,{
            countryCode,jurisdictionId,invoiceDate:String(body.issue_date),
            treatment:String(tax.tax_treatment || "standard"),
            taxCode:typeof tax.tax_code === "string" ? tax.tax_code : null,
          },Deno.env.get("ALLOW_DRAFT_TAX_RULES") !== "false");
          if (!resolved.ok) return globalJson({error:resolved.message || "No effective workspace tax rule is available.",code:resolved.code},422,origin);
          const subtotalMinor = items.reduce((sum:any,item:any)=>sum + Math.round(item.quantity * item.unit_price_minor),0);
          const discountMinor = items.reduce((sum:any,item:any)=>sum + item.discount_minor,0);
          const taxableMinor = Math.max(0,subtotalMinor-discountMinor);
          const components = resolved.rule.components;
          taxMinor = components.reduce((sum:any,component:any)=>sum + Math.floor((taxableMinor*component.rateBps+5000)/10000),0);
          if (![subtotalMinor,discountMinor,taxableMinor,taxMinor].every(Number.isSafeInteger)) {
            return globalJson({error:"Invoice tax amount is outside supported limits."},422,origin);
          }
          taxSnapshot = {
            countryCode,currencyCode,jurisdictionId,ruleId:resolved.rule.id,version:resolved.rule.version,
            effectiveFrom:resolved.rule.effectiveFrom,effectiveTo:resolved.rule.effectiveTo,
            treatment:resolved.rule.treatment,components,status:resolved.mode,
            taxableMinor,taxMinor,totalMinor:taxableMinor+taxMinor,
            source:resolved.rule.source,calculatedAt:new Date().toISOString(),
            warning:resolved.mode === "draft_test"
              ? "Draft baseline rule for testing only; not legally verified and not for production issuance."
              : countryCode === "US" ? "State-level baseline only; local city, county and special-district taxes are not included." : null,
          };
        }
        const invoiceId = data?.invoice?.id;
        if (!invoiceId) return globalJson({error:"Invoice draft was created but its ID could not be verified."},500,origin);
        const {data:updatedInvoice,error:updateError} = await auth.admin.schema("global").from("invoices")
          .update({tax_minor:taxMinor,total_minor:taxableMinor+taxMinor,invoice_snapshot:{
            ...(isObject(data.invoice.invoice_snapshot) ? data.invoice.invoice_snapshot : {}),
            workspace_country_code:countryCode,global_tax_snapshot:taxSnapshot,
          }})
          .eq("id",invoiceId).eq("workspace_id",workspaceId).select("*").single();
        if (updateError || !updatedInvoice) return globalJson({error:"Invoice draft saved but its tax snapshot could not be synchronized."},500,origin);
        data.invoice = updatedInvoice;
        data.tax_snapshot = taxSnapshot;
      }
      return globalJson(data, 201, origin);
    }

    if (body.action === "record_payment") {
      if (typeof body.invoice_id !== "string" || !UUID.test(body.invoice_id)
        || typeof body.amount_minor !== "number" || !Number.isSafeInteger(body.amount_minor) || body.amount_minor <= 0
        || typeof body.currency_code !== "string" || !/^[A-Z]{3}$/.test(body.currency_code)
        || !validDate(body.payment_date)
        || typeof body.idempotency_key !== "string" || !UUID.test(body.idempotency_key)) {
        return globalJson({ error: "Payment details are invalid." }, 400, origin);
      }
      for (const [key, limit] of [["method", 80], ["reference", 160], ["notes", 1000]] as const) {
        if (body[key] !== undefined && body[key] !== null && (typeof body[key] !== "string" || body[key].length > limit)) {
          return globalJson({ error: `Invalid ${key} value.` }, 400, origin);
        }
      }
      const { data, error } = await auth.admin.rpc("global_record_invoice_payment", {
        p_user_id: auth.user.id,
        p_workspace_id: workspaceId,
        p_invoice_id: body.invoice_id,
        p_amount_minor: body.amount_minor,
        p_currency_code: body.currency_code,
        p_payment_date: body.payment_date,
        p_method: body.method ?? null,
        p_reference: body.reference ?? null,
        p_notes: body.notes ?? null,
        p_idempotency_key: body.idempotency_key,
      });
      if (error) {
        console.error("Global payment ledger RPC failed", { code: error.code });
        return globalJson({ error: "Payment ledger service is not ready. Please try again later." }, 503, origin);
      }
      if (!data?.ok) {
        const reason = String(data?.reason || "request_failed");
        const messages: Record<string, string> = {
          access_denied: "You do not have access to this Global workspace.",
          forbidden: "Your workspace role cannot record payments.",
          invoice_not_found: "Invoice not found.",
          invoice_not_payable: "Only issued invoices can receive payment records.",
          invalid_currency: "Payment currency must match the invoice currency.",
          invalid_payment: "Payment details are invalid.",
          overpayment: "Payment exceeds the remaining invoice balance.",
          idempotency_conflict: "This request ID was already used for a different payment.",
        };
        return globalJson({ error: messages[reason] || "Could not record the payment.", reason, remaining_minor: data?.remaining_minor }, statusFor(reason), origin);
      }
      return globalJson(data, 200, origin);
    }

    if (body.action === "capabilities") {
      const { data, error } = await auth.admin.rpc("global_list_invoice_reconciliation", {
        p_user_id: auth.user.id,
        p_workspace_id: workspaceId,
        p_limit: 1,
      });
      const ledgerReady = !error && data?.ok === true;
      const commercialProbe = await auth.admin.rpc("global_issue_commercial_invoice", {
        p_user_id:null, p_workspace_id:null, p_invoice_id:null, p_idempotency_key:null,
      });
      const atomicCommercialProbe = await auth.admin.rpc("global_create_and_issue_commercial_invoice", {
        p_user_id:null, p_workspace_id:null, p_client_id:null, p_currency_code:null,
        p_issue_date:null, p_due_date:null, p_notes:null, p_items:null, p_idempotency_key:null,
      });
      const atomicTaxProbe = await auth.admin.rpc("global_create_and_issue_tax_invoice", {
        p_user_id:null, p_workspace_id:null, p_client_id:null, p_currency_code:null,
        p_issue_date:null, p_due_date:null, p_notes:null, p_items:null, p_tax_context:null, p_idempotency_key:null,
      });
      const commercialFunctionReady = !commercialProbe.error && commercialProbe.data?.reason === "invalid_request"
        && !atomicCommercialProbe.error && atomicCommercialProbe.data?.reason === "invalid_request";
      const taxFunctionReady = !atomicTaxProbe.error && atomicTaxProbe.data?.reason === "invalid_request";
      const commercialCountries = ["US","GB","AE","CA","AU","SG"];
      return globalJson({
        ok: true,
        ledger_ready: ledgerReady,
        issuance_ready: ledgerReady && taxFunctionReady && data?.country_code === "GB",
        issuance_countries: ["GB"],
        commercial_issuance_ready: ledgerReady && commercialFunctionReady && commercialCountries.includes(data?.country_code),
        commercial_issuance_countries: commercialCountries,
        country_code: data?.country_code || null,
      }, 200, origin);
    }

    if (body.action === "issue") {
      if (typeof body.invoice_id !== "string" || !UUID.test(body.invoice_id)
        || typeof body.idempotency_key !== "string" || !UUID.test(body.idempotency_key)
        || !isObject(body.tax_context)) {
        return globalJson({ error: "Invoice issuance details are invalid." }, 400, origin);
      }
      const tax = body.tax_context;
      if (typeof tax.registration_confirmed !== "boolean"
        || typeof tax.place_of_supply_confirmed !== "boolean"
        || typeof tax.tax_category_confirmed !== "boolean"
        || typeof tax.tax_category !== "string"
        || typeof tax.mode !== "string"
        || typeof tax.price_mode !== "string"
        || typeof tax.place_of_supply !== "string") {
        return globalJson({ error: "Required tax evidence is incomplete." }, 400, origin);
      }
      const { data, error } = await auth.admin.rpc("global_issue_invoice", {
        p_user_id: auth.user.id,
        p_workspace_id: workspaceId,
        p_invoice_id: body.invoice_id,
        p_tax_context: tax,
        p_idempotency_key: body.idempotency_key,
      });
      if (error) {
        console.error("Global invoice issuance RPC failed", { code: error.code });
        const message = String(error.message || "");
        if (message.includes("insufficient_stock") || message.includes("insufficient_batch_stock")) {
          return globalJson({ error: "Not enough available stock in the default warehouse to issue this invoice.", reason: "insufficient_stock" }, 409, origin);
        }
        if (message.includes("invoice_warehouse_not_found")) {
          return globalJson({ error: "Set up an active default warehouse before issuing stock-tracked invoices.", reason: "warehouse_not_found" }, 409, origin);
        }
        if (message.includes("approval_required")) {
          return globalJson({ error:"An authorised approver must approve this invoice before it can be issued.", reason:"approval_required" },409,origin);
        }
        return globalJson({ error: "Invoice issuance service is not ready. Please try again later." }, 503, origin);
      }
      if (!data?.ok) {
        const reason = String(data?.reason || "request_failed");
        const messages: Record<string, string> = {
          access_denied: "You do not have access to this Global workspace.",
          forbidden: "Your workspace role cannot issue invoices.",
          invoice_not_found: "Invoice not found.",
          invoice_not_draft: "Only a draft invoice can be issued.",
          country_not_enabled: "Global invoice issuance is not enabled for this country yet.",
          seller_profile_incomplete: "Complete the seller's legal name, address and active tax registration profile before issuing.",
          tax_evidence_incomplete: "Confirm active registration, place of supply and standard-rated VAT treatment before issuing.",
          invalid_invoice_amounts: "Invoice amounts are invalid.",
          invoice_total_limit: "The invoice total exceeds the supported limit.",
          idempotency_conflict: "This request ID was already used for another invoice.",
        };
        const status = ["access_denied","forbidden"].includes(reason) ? 403
          : ["invoice_not_found"].includes(reason) ? 404
          : ["invoice_not_draft","idempotency_conflict"].includes(reason) ? 409 : 400;
        return globalJson({ error: messages[reason] || "Could not issue this invoice.", reason }, status, origin);
      }
      return globalJson(data, 200, origin);
    }

    if (body.action === "issue_commercial") {
      if (typeof body.invoice_id !== "string" || !UUID.test(body.invoice_id)
        || typeof body.idempotency_key !== "string" || !UUID.test(body.idempotency_key)) {
        return globalJson({ error:"Commercial invoice issuance details are invalid." },400,origin);
      }
      const { data, error } = await auth.admin.rpc("global_issue_commercial_invoice", {
        p_user_id:auth.user.id,
        p_workspace_id:workspaceId,
        p_invoice_id:body.invoice_id,
        p_idempotency_key:body.idempotency_key,
      });
      if (error) {
        const message = String(error.message || "");
        if (message.includes("approval_required")) {
          return globalJson({ error:"An authorised approver must approve this invoice before it can be issued.", reason:"approval_required" },409,origin);
        }
        console.error("Global commercial invoice RPC failed", { code:error.code });
        return globalJson({ error:"Commercial invoice issuance service is not ready. Please try again later." },503,origin);
      }
      if (!data?.ok) {
        const reason = String(data?.reason || "request_failed");
        const messages: Record<string,string> = {
          access_denied:"You do not have access to this Global workspace.",
          forbidden:"Your workspace role cannot issue invoices.",
          invoice_not_found:"Invoice not found.",
          invoice_not_draft:"Only a draft invoice can be issued.",
          country_not_enabled:"Commercial invoices are not enabled for this workspace country/currency.",
          seller_profile_incomplete:"Add the seller legal business name and registered business address before issuing.",
          invalid_invoice_amounts:"Invoice amounts are invalid.",
          invoice_total_limit:"The invoice total exceeds the supported limit.",
          idempotency_conflict:"This request ID was already used for another invoice.",
        };
        const status = ["access_denied","forbidden"].includes(reason) ? 403
          : reason === "invoice_not_found" ? 404
          : ["invoice_not_draft","idempotency_conflict"].includes(reason) ? 409 : 400;
        return globalJson({ error:messages[reason] || "Could not issue the commercial invoice.",reason },status,origin);
      }
      return globalJson(data,200,origin);
    }

    if (body.action === "record_refund") {
      if (typeof body.invoice_id !== "string" || !UUID.test(body.invoice_id)
        || typeof body.amount_minor !== "number" || !Number.isSafeInteger(body.amount_minor) || body.amount_minor <= 0
        || typeof body.currency_code !== "string" || !/^[A-Z]{3}$/.test(body.currency_code)
        || !validDate(body.refund_date)
        || typeof body.idempotency_key !== "string" || !UUID.test(body.idempotency_key)) {
        return globalJson({ error: "Refund details are invalid." }, 400, origin);
      }
      for (const [key, limit] of [["method", 80], ["reference", 160], ["reason", 500]] as const) {
        if (body[key] !== undefined && body[key] !== null && (typeof body[key] !== "string" || body[key].length > limit)) {
          return globalJson({ error: "Invalid " + key + " value." }, 400, origin);
        }
      }
      const { data, error } = await auth.admin.rpc("global_record_invoice_refund", {
        p_user_id: auth.user.id,
        p_workspace_id: workspaceId,
        p_invoice_id: body.invoice_id,
        p_amount_minor: body.amount_minor,
        p_currency_code: body.currency_code,
        p_refund_date: body.refund_date,
        p_method: body.method ?? null,
        p_reference: body.reference ?? null,
        p_reason: body.reason ?? null,
        p_idempotency_key: body.idempotency_key,
      });
      if (error) {
        console.error("Global invoice refund RPC failed", { code: error.code });
        return globalJson({ error: "Invoice refund service is not ready. Please try again later." }, 503, origin);
      }
      if (!data?.ok) {
        const reason = String(data?.reason || "request_failed");
        const messages: Record<string, string> = {
          access_denied: "You do not have access to this Global workspace.",
          forbidden: "Your workspace role cannot record refunds.",
          invoice_not_found: "Invoice not found.",
          invoice_not_refundable: "This invoice is not eligible for a refund record.",
          invalid_refund: "Refund details are invalid.",
          refund_exceeds_net_payments: "Refund exceeds the amount received after previous refunds.",
          idempotency_conflict: "This request ID was already used for a different refund.",
        };
        const status = ["access_denied","forbidden"].includes(reason) ? 403
          : reason === "invoice_not_found" ? 404
          : ["invoice_not_refundable","idempotency_conflict","refund_exceeds_net_payments"].includes(reason) ? 409 : 400;
        return globalJson({ error: messages[reason] || "Could not record the refund.", reason, available_minor: data?.available_minor }, status, origin);
      }
      return globalJson(data, 200, origin);
    }

    if (body.action === "list_reconciliation") {
      const requestedLimit = body.limit === undefined ? 100 : Number(body.limit);
      if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 200) {
        return globalJson({ error: "Reconciliation limit must be between 1 and 200." }, 400, origin);
      }
      const { data, error } = await auth.admin.rpc("global_list_invoice_reconciliation", {
        p_user_id: auth.user.id,
        p_workspace_id: workspaceId,
        p_limit: requestedLimit,
      });
      if (error) {
        console.error("Global invoice reconciliation RPC failed", { code: error.code });
        return globalJson({ error: "Invoice reconciliation service is not ready. Please try again later." }, 503, origin);
      }
      if (!data?.ok) {
        const reason = String(data?.reason || "request_failed");
        return globalJson({
          error: reason === "access_denied" ? "You do not have access to this Global workspace." : "Could not load invoice reconciliation.",
          reason,
        }, reason === "access_denied" ? 403 : 400, origin);
      }
      return globalJson(data, 200, origin);
    }

    return globalJson({ error: "Unsupported invoice action." }, 400, origin);
  } catch (error) {
    console.error("global-invoices failed", error);
    return globalJson({ error: "Something went wrong with the Global invoice request." }, 500, origin);
  }
});
