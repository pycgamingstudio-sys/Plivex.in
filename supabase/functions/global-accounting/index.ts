import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
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
  return typeof value === "string" && DATE.test(value) && !Number.isNaN(Date.parse(value));
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
