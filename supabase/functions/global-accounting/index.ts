import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { isValidIsoDate } from "../../../src/global/date-validation.js";
import { authenticateGlobal, globalCorsHeaders, globalJson, isGlobalOriginAllowed } from "../_shared/global.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY = /^[A-Z]{3}$/;
const SOURCES = new Set(["manual","opening_balance","invoice_issued","invoice_payment","invoice_refund","expense","purchase","stock_adjustment"]);
const MAX_BODY_BYTES = 64 * 1024;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function validDate(value: unknown): value is string {
  return isValidIsoDate(value);
}
function validUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
function errorStatus(reason: string): number {
  if (["access_denied","forbidden"].includes(reason)) return 403;
  if (reason === "workspace_not_found") return 404;
  return 400;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!isGlobalOriginAllowed(origin)) return globalJson({ error: "Origin not allowed" },403,origin);
  if (req.method === "OPTIONS") return new Response("ok",{headers:globalCorsHeaders(origin)});
  if (req.method !== "POST") return globalJson({error:"Method not allowed"},405,origin);

  const auth = await authenticateGlobal(req);
  if ("error" in auth) return globalJson({error:auth.error},auth.status,origin);

  try {
    const declared = Number(req.headers.get("content-length") || 0);
    if (declared > MAX_BODY_BYTES) return globalJson({error:"Request is too large."},413,origin);
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return globalJson({error:"Request is too large."},413,origin);
    let body: Record<string,unknown>;
    try { body = JSON.parse(raw); } catch { return globalJson({error:"Invalid JSON request."},400,origin); }
    if (!isObject(body) || !validUuid(body.workspace_id)) return globalJson({error:"A valid workspace_id is required."},400,origin);

    const workspaceId = body.workspace_id;
    const action = body.action;
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !anon) return globalJson({error:"Accounting service is not configured."},503,origin);
    const userClient = createClient(url,anon,{
      global:{headers:{Authorization:req.headers.get("Authorization") || ""}},
      auth:{persistSession:false,autoRefreshToken:false},
    });

    if (action === "post_journal_entry") {
      if (!validDate(body.entry_date) || typeof body.currency_code !== "string" || !CURRENCY.test(body.currency_code)
        || typeof body.memo !== "string" || !body.memo.trim() || body.memo.length>500
        || !SOURCES.has(String(body.source_type || "manual")) || !validUuid(body.idempotency_key)
        || (body.source_id !== undefined && body.source_id !== null && !validUuid(body.source_id))
        || !Array.isArray(body.lines) || body.lines.length<2 || body.lines.length>100) {
        return globalJson({error:"Journal date, currency, memo, source, idempotency key and 2–100 lines are required."},400,origin);
      }
      for (const line of body.lines) {
        if (!isObject(line) || typeof line.account_code !== "string" || line.account_code.length>20
          || !Number.isSafeInteger(line.debit_minor ?? 0) || !Number.isSafeInteger(line.credit_minor ?? 0)
          || Number(line.debit_minor ?? 0)<0 || Number(line.credit_minor ?? 0)<0
          || (Number(line.debit_minor ?? 0)>0 && Number(line.credit_minor ?? 0)>0)
          || (Number(line.debit_minor ?? 0)===0 && Number(line.credit_minor ?? 0)===0)
          || (line.description !== undefined && line.description !== null && (typeof line.description!=="string" || line.description.length>300))) {
          return globalJson({error:"Each journal line needs an account code and exactly one positive debit or credit amount."},400,origin);
        }
      }
      const {data,error} = await auth.admin.rpc("global_post_journal_entry",{
        p_user_id:auth.user.id,p_workspace_id:workspaceId,p_entry_date:body.entry_date,
        p_currency_code:body.currency_code,p_memo:body.memo,p_source_type:body.source_type || "manual",
        p_source_id:body.source_id || null,p_lines:body.lines,p_idempotency_key:body.idempotency_key,
      });
      if (error) {
        console.error("Global accounting journal RPC failed",{code:error.code});
        return globalJson({error:"Journal posting service is temporarily unavailable."},503,origin);
      }
      if (!data?.ok) {
        const reason=String(data?.reason || "request_failed");
        const messages:Record<string,string>={
          access_denied:"You do not have access to this workspace.",
          forbidden:"Your workspace role cannot post journal entries.",
          currency_mismatch:"Journal currency must match the workspace base currency.",
          unbalanced_journal:"Debits and credits must balance exactly.",
          account_not_found:"A selected account is unavailable in this workspace.",
          idempotency_conflict:"This request key was already used for different journal data.",
        };
        return globalJson({error:messages[reason] || "Journal entry could not be posted.",reason},errorStatus(reason),origin);
      }
      return globalJson(data,200,origin);
    }

    const integerField=(value:unknown)=>typeof value==="number"&&Number.isSafeInteger(value)&&value>=0;
    const purchaseMutations:Record<string,{rpc:string,args:Record<string,unknown>}> = {};
    if (action==="create_purchase_bill") {
      const lines=body.lines;
      const required=["supplier_name","supplier_invoice_number","purchase_date","currency_code","fx_rate_date","fx_rate_source","idempotency_key"];
      if (required.some((key)=>typeof body[key]!=="string" || !String(body[key]).trim())
        || !validDate(body.purchase_date) || !validDate(body.fx_rate_date) || !CURRENCY.test(String(body.currency_code))
        || !validUuid(body.idempotency_key) || !integerField(body.subtotal_minor) || Number(body.subtotal_minor)<=0
        || !integerField(body.tax_minor) || !integerField(body.tax_recoverable_minor)
        || !integerField(body.base_subtotal_minor) || Number(body.base_subtotal_minor)<=0
        || !integerField(body.base_tax_minor) || !integerField(body.base_tax_recoverable_minor)
        || !Number.isSafeInteger(body.fx_rate_numerator) || Number(body.fx_rate_numerator)<=0
        || !Number.isSafeInteger(body.fx_rate_denominator) || Number(body.fx_rate_denominator)<=0
        || !Array.isArray(lines) || lines.length<1 || lines.length>100) {
        return globalJson({error:"Supplier, bill details, FX evidence, totals and 1–100 purchase lines are required."},400,origin);
      }
      for (const line of lines) {
        if (!isObject(line) || !validUuid(line.product_id) || typeof line.quantity!=="number" || !Number.isFinite(line.quantity)
          || line.quantity<=0 || !integerField(line.unit_cost_minor) || Number(line.unit_cost_minor)<=0
          || !integerField(line.line_total_minor) || Number(line.line_total_minor)<=0
          || !integerField(line.base_line_total_minor) || Number(line.base_line_total_minor)<=0
          || (line.description!==undefined && line.description!==null && (typeof line.description!=="string" || line.description.length>300))) {
          return globalJson({error:"Each purchase line needs a product, positive quantity and reconciled source/base amounts."},400,origin);
        }
      }
      purchaseMutations.create_purchase_bill={rpc:"global_create_purchase_bill",args:{
        p_user_id:auth.user.id,p_workspace_id:workspaceId,p_supplier_name:body.supplier_name,
        p_supplier_email:body.supplier_email||null,p_supplier_tax_id:body.supplier_tax_id||null,
        p_supplier_invoice_number:body.supplier_invoice_number,p_purchase_date:body.purchase_date,p_due_date:body.due_date||null,
        p_currency_code:body.currency_code,p_subtotal_minor:body.subtotal_minor,p_tax_minor:body.tax_minor,
        p_tax_recoverable_minor:body.tax_recoverable_minor,p_base_subtotal_minor:body.base_subtotal_minor,
        p_base_tax_minor:body.base_tax_minor,p_base_tax_recoverable_minor:body.base_tax_recoverable_minor,
        p_fx_rate_numerator:body.fx_rate_numerator,p_fx_rate_denominator:body.fx_rate_denominator,
        p_fx_rate_date:body.fx_rate_date,p_fx_rate_source:body.fx_rate_source,p_lines:lines,
        p_memo:body.memo||null,p_idempotency_key:body.idempotency_key,
      }};
    } else if (action==="post_purchase_bill") {
      if (!validUuid(body.purchase_bill_id)) return globalJson({error:"A valid purchase_bill_id is required."},400,origin);
      purchaseMutations.post_purchase_bill={rpc:"global_post_purchase_bill",args:{p_user_id:auth.user.id,p_workspace_id:workspaceId,p_purchase_bill_id:body.purchase_bill_id}};
    } else if (action==="record_purchase_payment") {
      if (!validUuid(body.purchase_bill_id)||!validUuid(body.idempotency_key)||!validDate(body.payment_date)||!validDate(body.fx_rate_date)
        || typeof body.currency_code!=="string"||!CURRENCY.test(body.currency_code)
        || !integerField(body.amount_minor)||Number(body.amount_minor)<=0||!integerField(body.base_amount_minor)||Number(body.base_amount_minor)<=0
        || !Number.isSafeInteger(body.fx_rate_numerator)||Number(body.fx_rate_numerator)<=0
        || !Number.isSafeInteger(body.fx_rate_denominator)||Number(body.fx_rate_denominator)<=0
        || typeof body.fx_rate_source!=="string"||!body.fx_rate_source.trim()||body.fx_rate_source.length>240) {
        return globalJson({error:"Purchase payment amount, currency, FX rate evidence, date and idempotency key are required."},400,origin);
      }
      purchaseMutations.record_purchase_payment={rpc:"global_record_purchase_payment",args:{
        p_user_id:auth.user.id,p_workspace_id:workspaceId,p_purchase_bill_id:body.purchase_bill_id,
        p_amount_minor:body.amount_minor,p_currency_code:body.currency_code,p_base_amount_minor:body.base_amount_minor,
        p_fx_rate_numerator:body.fx_rate_numerator,p_fx_rate_denominator:body.fx_rate_denominator,
        p_fx_rate_date:body.fx_rate_date,p_fx_rate_source:body.fx_rate_source,p_payment_date:body.payment_date,
        p_method:body.method||null,p_reference:body.reference||null,p_idempotency_key:body.idempotency_key,
      }};
    } else if (action==="revalue_purchase_bill") {
      if (!validUuid(body.purchase_bill_id)||!validUuid(body.idempotency_key)||!validDate(body.revaluation_date)
        || !Number.isSafeInteger(body.fx_rate_numerator)||Number(body.fx_rate_numerator)<=0
        || !Number.isSafeInteger(body.fx_rate_denominator)||Number(body.fx_rate_denominator)<=0
        || typeof body.fx_rate_source!=="string"||!body.fx_rate_source.trim()||body.fx_rate_source.length>240) {
        return globalJson({error:"Purchase bill, revaluation date, positive FX rate and rate source are required."},400,origin);
      }
      purchaseMutations.revalue_purchase_bill={rpc:"global_revalue_purchase_bill",args:{
        p_user_id:auth.user.id,p_workspace_id:workspaceId,p_purchase_bill_id:body.purchase_bill_id,
        p_revaluation_date:body.revaluation_date,p_fx_rate_numerator:body.fx_rate_numerator,
        p_fx_rate_denominator:body.fx_rate_denominator,p_fx_rate_source:body.fx_rate_source,
        p_idempotency_key:body.idempotency_key,
      }};
    } else if (action==="import_gstr2b") {
      const period=String(body.period||"");
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || !Array.isArray(body.rows) || body.rows.length<1 || body.rows.length>2000) {
        return globalJson({error:"A valid return period and 1–2,000 GSTR-2B rows are required."},400,origin);
      }
      const {data,error}=await auth.admin.rpc("global_import_gstr2b_rows",{p_user_id:auth.user.id,p_workspace_id:workspaceId,p_return_period:period,p_rows:body.rows});
      if(error){console.error("Global GSTR-2B import failed",{code:error.code});return globalJson({error:"GSTR-2B import could not be saved."},400,origin);}
      return globalJson(data,200,origin);
    } else if (action==="list_gstr2b") {
      const period=String(body.period||"");
      const limit=Number(body.limit||2000);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || !Number.isInteger(limit)||limit<1||limit>2000) return globalJson({error:"A valid GSTR-2B period and row limit are required."},400,origin);
      const {data,error}=await auth.admin.rpc("global_list_gstr2b_rows",{p_user_id:auth.user.id,p_workspace_id:workspaceId,p_return_period:period,p_limit:limit});
      if(error){console.error("Global GSTR-2B list failed",{code:error.code});return globalJson({error:"GSTR-2B records are temporarily unavailable."},503,origin);}
      return globalJson(data,200,origin);
    } else if (action==="list_purchase_bills") {
      const limit=Number(body.limit||100);
      if (!Number.isInteger(limit)||limit<1||limit>200) return globalJson({error:"Purchase bill limit must be between 1 and 200."},400,origin);
      const {data,error}=await auth.admin.rpc("global_list_purchase_bills",{p_user_id:auth.user.id,p_workspace_id:workspaceId,p_limit:limit});
      if(error){console.error("Global purchase list failed",{code:error.code});return globalJson({error:"Purchase bills are temporarily unavailable."},503,origin);}
      return globalJson(data,200,origin);
    }
    if (action==="save_gst_filing_calendar") {
      const period=String(body.period||"");
      const returnType=String(body.return_type||"");
      const dueDate=String(body.due_date||"");
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)||!["GSTR1","GSTR3B"].includes(returnType)
        ||!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)||!["planned","filed"].includes(String(body.status||"planned"))
        ||String(body.filing_reference||"").length>120||String(body.notes||"").length>500) {
        return globalJson({error:"Return type, period, confirmed due date and status are required."},400,origin);
      }
      const {data,error}=await auth.admin.rpc("global_save_gst_filing_calendar",{p_user_id:auth.user.id,p_workspace_id:workspaceId,
        p_return_type:returnType,p_return_period:period,p_due_date:dueDate,p_status:body.status||"planned",
        p_filing_reference:body.filing_reference||null,p_notes:body.notes||null});
      if(error){console.error("GST calendar save failed",{code:error.code});return globalJson({error:"GST filing calendar could not be saved."},400,origin);}
      return globalJson(data,200,origin);
    }
    if (action==="list_gst_filing_calendar") {
      const limit=Number(body.limit||100);
      if(!Number.isInteger(limit)||limit<1||limit>200)return globalJson({error:"GST calendar limit must be between 1 and 200."},400,origin);
      const {data,error}=await auth.admin.rpc("global_list_gst_filing_calendar",{p_user_id:auth.user.id,p_workspace_id:workspaceId,p_limit:limit});
      if(error){console.error("GST calendar list failed",{code:error.code});return globalJson({error:"GST filing calendar is temporarily unavailable."},503,origin);}
      return globalJson(data,200,origin);
    }
    const purchaseMutation=purchaseMutations[String(action||"")];
    if(purchaseMutation){
      const {data,error}=await auth.admin.rpc(purchaseMutation.rpc,purchaseMutation.args);
      if(error){console.error("Global purchase accounting RPC failed",{rpc:purchaseMutation.rpc,code:error.code});return globalJson({error:"Purchase accounting service is temporarily unavailable."},503,origin);}
      if(!data?.ok){
        const reason=String(data?.reason||"request_failed");
        const messages:Record<string,string>={
          access_denied:"You do not have access to this workspace.",
          forbidden:"Your workspace role cannot perform this purchase action.",
          idempotency_conflict:"This request key was already used for different purchase data.",
          fx_conversion_mismatch:"The base-currency amount does not match the supplied FX rate.",
          overpayment:"The payment exceeds the outstanding supplier balance.",
          purchase_not_found:"Purchase bill was not found.",
          purchase_not_payable:"This purchase bill is not payable.",
          purchase_not_open:"This purchase bill has no open foreign-currency balance.",
        };
        return globalJson({error:messages[reason]||"Purchase accounting action could not be completed.",reason},errorStatus(reason),origin);
      }
      return globalJson(data,200,origin);
    }

    const reportArgs:Record<string,unknown>={p_workspace_id:workspaceId};
    let rpcName:string;
    if (action === "trial_balance") {
      if (body.from !== undefined && body.from !== null && !validDate(body.from)) return globalJson({error:"Invalid start date."},400,origin);
      if (body.to !== undefined && body.to !== null && !validDate(body.to)) return globalJson({error:"Invalid end date."},400,origin);
      if (body.currency_code !== undefined && (typeof body.currency_code!=="string" || !CURRENCY.test(body.currency_code))) return globalJson({error:"Invalid currency code."},400,origin);
      reportArgs.p_from=body.from || null; reportArgs.p_to=body.to || null; reportArgs.p_currency_code=body.currency_code || null;
      rpcName="global_get_trial_balance";
    } else if (action === "general_ledger") {
      if (typeof body.account_code!=="string" || !body.account_code.trim() || body.account_code.length>20) return globalJson({error:"A valid account code is required."},400,origin);
      if (body.from !== undefined && body.from !== null && !validDate(body.from)) return globalJson({error:"Invalid start date."},400,origin);
      if (body.to !== undefined && body.to !== null && !validDate(body.to)) return globalJson({error:"Invalid end date."},400,origin);
      if (body.currency_code !== undefined && (typeof body.currency_code!=="string" || !CURRENCY.test(body.currency_code))) return globalJson({error:"Invalid currency code."},400,origin);
      reportArgs.p_account_code=body.account_code.trim(); reportArgs.p_from=body.from || null;
      reportArgs.p_to=body.to || null; reportArgs.p_currency_code=body.currency_code || null;
      rpcName="global_get_general_ledger";
    } else if (action === "financial_statements") {
      if (!validDate(body.as_of) || (body.from !== undefined && body.from !== null && !validDate(body.from))) return globalJson({error:"Valid reporting dates are required."},400,origin);
      if (body.from && body.as_of < body.from) return globalJson({error:"The as-of date must be on or after the reporting start date."},400,origin);
      if (body.currency_code !== undefined && (typeof body.currency_code!=="string" || !CURRENCY.test(body.currency_code))) return globalJson({error:"Invalid currency code."},400,origin);
      reportArgs.p_period_from=body.from || null; reportArgs.p_as_of=body.as_of; reportArgs.p_currency_code=body.currency_code || null;
      rpcName="global_get_financial_statements";
    } else {
      return globalJson({error:"Unsupported accounting action."},400,origin);
    }

    const {data,error}=await userClient.rpc(rpcName,reportArgs);
    if (error) {
      if (error.code==="42501") return globalJson({error:"You do not have access to this workspace."},403,origin);
      console.error("Global accounting report RPC failed",{code:error.code});
      return globalJson({error:"Accounting report is temporarily unavailable."},503,origin);
    }
    return globalJson({ok:true,report:data},200,origin);
  } catch (error) {
    console.error("global-accounting failed",error);
    return globalJson({error:"Something went wrong with the accounting service."},500,origin);
  }
});
