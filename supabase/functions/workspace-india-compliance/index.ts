import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { isValidIsoDate } from "../../../src/global/date-validation.js";

const ORIGINS = new Set(["https://plivex.in","https://www.plivex.in","https://plivex.netlify.app"]);
const allowed = (origin: string | null) => !origin || ORIGINS.has(origin) || /^https:\/\/(?:[a-z0-9-]+\.)?[a-z0-9-]+\.(?:pages|workers)\.dev$/.test(origin);
const cors = (origin: string | null) => ({ "Access-Control-Allow-Origin": origin && allowed(origin) ? origin : "https://plivex.in", "Vary":"Origin", "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods":"POST, OPTIONS" });
const json = (body: unknown,status=200,origin: string|null=null) => new Response(JSON.stringify(body),{status,headers:{...cors(origin),"Content-Type":"application/json","Cache-Control":"no-store"}});
const isObject = (value: unknown): value is Record<string,any> => !!value && typeof value==="object" && !Array.isArray(value);
const clean = (value: unknown,max=200) => String(value??"").trim().slice(0,max);
const validUuid = (value: unknown) => typeof value==="string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const sha256 = async (value: unknown) => {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,"0")).join("");
};
const gstin = (value: unknown) => typeof value==="string" && /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(value.toUpperCase());
const pan = (value: unknown) => typeof value==="string" && /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(value.toUpperCase());
const fyQuarter = (date: string) => {
  const [year,month] = date.split("-").map(Number);
  const fyStart = month>=4 ? year : year-1;
  const quarter = month>=4 && month<=6 ? "Q1" : month>=7 && month<=9 ? "Q2" : month>=10 && month<=12 ? "Q3" : "Q4";
  return { financial_year:fyStart+"-"+String((fyStart+1)%100).padStart(2,"0"), quarter };
};

async function authenticate(req: Request) {
  const authorization=req.headers.get("Authorization")||"";
  if(!authorization.startsWith("Bearer ")) throw new Error("AUTH_REQUIRED");
  const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!anon||!service) throw new Error("SERVICE_NOT_CONFIGURED");
  const authClient=createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error}=await authClient.auth.getUser();
  if(error||!user) throw new Error("AUTH_REQUIRED");
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:profile,error:profileError}=await admin.from("profiles").select("workspace_id").eq("id",user.id).maybeSingle();
  if(profileError||!profile?.workspace_id) throw new Error("WORKSPACE_ACCESS_UNAVAILABLE");
  const workspaceId=String(profile.workspace_id);
  const [{data:settings,error:settingsError},{data:member,error:memberError}]=await Promise.all([
    admin.from("workspace_settings").select("workspace_id,country_code,currency_code").eq("workspace_id",workspaceId).maybeSingle(),
    admin.from("workspace_members").select("role,status").eq("workspace_id",workspaceId).eq("user_id",user.id).eq("status","active").maybeSingle(),
  ]);
  if(settingsError||memberError||!settings) throw new Error("WORKSPACE_ACCESS_UNAVAILABLE");
  if(!member) throw new Error("WORKSPACE_MEMBERSHIP_REQUIRED");
  return {admin,user,workspaceId,settings,role:String(member.role||"")};
}
const canManage = (role:string) => ["owner","admin","manager"].includes(role);
const canAccount = (role:string) => ["owner","admin","manager","accountant"].includes(role);

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("origin");
  if(!allowed(origin)) return json({error:"Origin not allowed"},403,origin);
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors(origin)});
  if(req.method!=="POST") return json({error:"Method not allowed"},405,origin);
  try {
    const declared=Number(req.headers.get("content-length")||0);
    if(declared>64*1024) return json({error:"Request too large"},413,origin);
    const raw=await req.text();
    if(new TextEncoder().encode(raw).byteLength>64*1024) return json({error:"Request too large"},413,origin);
    let body:Record<string,any>; try { body=JSON.parse(raw); } catch { return json({error:"Invalid JSON"},400,origin); }
    if(!isObject(body)) return json({error:"Invalid request"},400,origin);
    const {admin,user,workspaceId,settings,role}=await authenticate(req);
    if(body.workspace_id && body.workspace_id!==workspaceId) return json({error:"Workspace mismatch"},403,origin);
    if(settings.country_code!=="IN"||settings.currency_code!=="INR") return json({error:"India compliance records require an India Main Workspace with INR base currency."},409,origin);
    const action=String(body.action||"");
    if(action==="capabilities") return json({ok:true,country_code:"IN",currency_code:"INR",tds_records:true,e_invoice_records:true,eway_bill_records:true,provider_submission:false,filing_enabled:false},200,origin);
    if(action==="list") {
      if(!canAccount(role)) return json({error:"Accountant or workspace manager permission required."},403,origin);
      const [tds,eInvoices,eWay,providers]=await Promise.all([
        admin.from("workspace_tds_entries").select("*").eq("workspace_id",workspaceId).order("deduction_date",{ascending:false}).limit(100),
        admin.from("workspace_einvoice_records").select("*").eq("workspace_id",workspaceId).order("created_at",{ascending:false}).limit(100),
        admin.from("workspace_eway_bill_records").select("*").eq("workspace_id",workspaceId).order("created_at",{ascending:false}).limit(100),
        admin.from("workspace_compliance_provider_connections").select("provider_type,provider_name,environment,status,external_account_reference,metadata").eq("workspace_id",workspaceId),
      ]);
      const error=tds.error||eInvoices.error||eWay.error||providers.error;
      if(error) throw new Error("COMPLIANCE_RECORDS_UNAVAILABLE");
      return json({ok:true,tds_entries:tds.data||[],einvoices:eInvoices.data||[],eway_bills:eWay.data||[],providers:providers.data||[]},200,origin);
    }
    if(action==="create_tds_entry") {
      if(!canAccount(role)) return json({error:"Accountant or workspace manager permission required."},403,origin);
      const section=clean(body.section_code,8).toUpperCase(),date=clean(body.deduction_date,10),name=clean(body.deductee_name,200),deducteePan=clean(body.deductee_pan,10).toUpperCase();
      const gross=body.gross_amount_minor,rate=body.tds_rate_bps,key=body.idempotency_key;
      const sourceType=clean(body.source_type,40);
      if(!["vendor_payment","professional_fee","rent","contractor","commission","other"].includes(sourceType)||!name||!/^19[0-9A-Z]{2,3}$/.test(section)||!isValidIsoDate(date)||!validUuid(key)
        ||!Number.isSafeInteger(gross)||gross<=0||gross>9000000000000000||!Number.isInteger(rate)||rate<0||rate>10000
        ||(deducteePan&&!pan(deducteePan))) return json({error:"TDS details are invalid. Check deductee, PAN, section, date, gross amount, rate and idempotency key."},400,origin);
      if(body.payment_date && !isValidIsoDate(body.payment_date)) return json({error:"Payment date must be a valid ISO calendar date."},400,origin);
      const tdsBig=(BigInt(gross)*BigInt(rate)+5000n)/10000n;
      const tds=Number(tdsBig);
      if(!Number.isSafeInteger(tds)||tds>gross) return json({error:"Calculated TDS amount is outside the permitted range."},400,origin);
      const period=fyQuarter(date);
      const normalized={source_type:sourceType,source_reference:clean(body.source_reference,120),deductee_name:name,deductee_pan:deducteePan,section_code:section,deduction_date:date,payment_date:isValidIsoDate(body.payment_date)?body.payment_date:null,gross_amount_minor:gross,tds_rate_bps:rate,tds_amount_minor:tds,financial_year:period.financial_year,quarter:period.quarter};
      const fingerprint=await sha256(normalized);
      const {data:existing}=await admin.from("workspace_tds_entries").select("*").eq("workspace_id",workspaceId).eq("idempotency_key",key).maybeSingle();
      if(existing) return existing.request_fingerprint===fingerprint ? json({ok:true,duplicate:true,entry:existing},200,origin) : json({error:"Idempotency key was already used for different TDS data."},409,origin);
      const {data,error}=await admin.from("workspace_tds_entries").insert({...normalized,workspace_id:workspaceId,currency_code:"INR",idempotency_key:key,request_fingerprint:fingerprint,created_by:user.id}).select("*").single();
      if(error) {
        const {data:retry}=await admin.from("workspace_tds_entries").select("*").eq("workspace_id",workspaceId).eq("idempotency_key",key).maybeSingle();
        if(retry) return retry.request_fingerprint===fingerprint ? json({ok:true,duplicate:true,entry:retry},200,origin) : json({error:"Idempotency key conflict."},409,origin);
        throw new Error("TDS_ENTRY_SAVE_FAILED");
      }
      return json({ok:true,duplicate:false,entry:data},201,origin);
    }
    if(action==="update_tds_status") {
      if(!canAccount(role)) return json({error:"Accountant or workspace manager permission required."},403,origin);
      if(!validUuid(body.entry_id)||!["deducted","deposited","filed","reversed"].includes(String(body.status))) return json({error:"TDS entry and target status are required."},400,origin);
      const {data:entry,error:entryError}=await admin.from("workspace_tds_entries").select("*").eq("workspace_id",workspaceId).eq("id",body.entry_id).maybeSingle();
      if(entryError||!entry) return json({error:"TDS entry not found."},404,origin);
      const transitions:Record<string,string[]>={draft:["deducted","reversed"],deducted:["deposited","reversed"],deposited:["filed","reversed"],filed:[],reversed:[]};
      const target=String(body.status);
      if(!transitions[entry.status]?.includes(target)) return json({error:"Invalid TDS status transition."},409,origin);
      const patch:Record<string,unknown>={status:target,updated_at:new Date().toISOString()};
      if(target==="deposited"||target==="filed") {
        const challan=clean(body.challan_number,80),challanDate=clean(body.challan_date,10),bsr=clean(body.bsr_code,20);
        if(!challan||!isValidIsoDate(challanDate)||!bsr) return json({error:"Challan number, valid challan date and BSR code are required before marking TDS deposited."},400,origin);
        patch.challan_number=challan;patch.challan_date=challanDate;patch.bsr_code=bsr;patch.deposit_reference=clean(body.deposit_reference,100)||null;
      }
      const {data,error}=await admin.from("workspace_tds_entries").update(patch).eq("workspace_id",workspaceId).eq("id",entry.id).eq("status",entry.status).select("*").maybeSingle();
      if(error) throw new Error("TDS_STATUS_UPDATE_FAILED");
      if(!data) return json({error:"TDS entry changed concurrently. Refresh and retry."},409,origin);
      return json({ok:true,entry:data},200,origin);
    }
    if(action==="prepare_einvoice") {
      if(!canAccount(role)) return json({error:"Accountant or workspace manager permission required."},403,origin);
      if(!validUuid(body.invoice_id)||!validUuid(body.idempotency_key)) return json({error:"Invoice and idempotency identifiers are required."},400,origin);
      const [{data:invoice,error:invoiceError},{data:seller,error:sellerError}]=await Promise.all([
        admin.from("invoices").select("id,workspace_id,number,issue_date,due_date,status,is_draft,currency,subtotal,tax_value,cgst,sgst,igst,total,invoice_snapshot,client_id,client_name").eq("id",body.invoice_id).eq("workspace_id",workspaceId).maybeSingle(),
        admin.from("business_profile").select("name,address,tax_registration_number,tax_registration_status,tax_registration_type").eq("workspace_id",workspaceId).maybeSingle(),
      ]);
      if(invoiceError||sellerError||!invoice||!seller) return json({error:"Invoice or seller profile could not be loaded in this workspace."},404,origin);
      if(invoice.is_draft||["cancelled","void"].includes(String(invoice.status||"").toLowerCase())) return json({error:"Only an issued, active invoice can be prepared for e-invoicing."},409,origin);
      const [{data:items,error:itemsError},{data:buyer,error:buyerError}]=await Promise.all([
        admin.from("invoice_items").select("description,quantity,rate,gst_rate,hsn_sac_code,unit_code").eq("invoice_id",invoice.id),
        invoice.client_id ? admin.from("clients").select("name,gstin,address").eq("id",invoice.client_id).eq("workspace_id",workspaceId).maybeSingle() : Promise.resolve({data:null,error:null}),
      ]);
      if(itemsError||buyerError) return json({error:"Invoice line or customer details could not be loaded."},500,origin);
      const errors:string[]=[];
      if(!gstin(seller.tax_registration_number)) errors.push("Seller GSTIN is missing or malformed.");
      if(!gstin(buyer?.gstin)) errors.push("Buyer GSTIN is required for this e-invoice workflow.");
      if(!invoice.number||!isValidIsoDate(invoice.issue_date)) errors.push("Invoice number and valid issue date are required.");
      if(!Array.isArray(items)||items.length===0) errors.push("At least one invoice line is required.");
      for(const [index,item] of (items||[]).entries()) {
        if(!/^\\d{4,8}$/.test(String(item.hsn_sac_code||""))) errors.push("Line "+(index+1)+": HSN/SAC code is required (4–8 digits).");
        if(!/^[A-Z0-9]{2,8}$/.test(String(item.unit_code||""))) errors.push("Line "+(index+1)+": valid unit code is required.");
        if(!Number.isFinite(Number(item.quantity))||Number(item.quantity)<=0||!Number.isFinite(Number(item.rate))||Number(item.rate)<0) errors.push("Line "+(index+1)+": invalid quantity or rate.");
      }
      const payload={document_type:"INV",document_number:invoice.number,document_date:invoice.issue_date,seller:{legal_name:seller.name,address:seller.address,gstin:seller.tax_registration_number},buyer:{name:buyer?.name||invoice.client_name,gstin:buyer?.gstin||null,address:buyer?.address||null},currency:"INR",tax_totals:{cgst:Number(invoice.cgst||0),sgst:Number(invoice.sgst||0),igst:Number(invoice.igst||0),total_tax:Number(invoice.tax_value||0)},total:Number(invoice.total||0),items:(items||[]).map((item:any)=>({description:item.description,hsn_sac_code:item.hsn_sac_code,unit_code:item.unit_code,quantity:item.quantity,unit_price:item.rate,tax_rate:item.gst_rate}))};
      const fingerprint=await sha256({invoice_id:invoice.id,payload});
      const {data:existing}=await admin.from("workspace_einvoice_records").select("*").eq("workspace_id",workspaceId).eq("invoice_id",invoice.id).maybeSingle();
      if(existing) {
        if(existing.request_fingerprint===fingerprint) return json({ok:true,duplicate:true,record:existing},200,origin);
        if(!["draft","rejected"].includes(existing.status)) return json({error:"An e-invoice record already exists and cannot be replaced after submission."},409,origin);
        const {data,error}=await admin.from("workspace_einvoice_records").update({status:errors.length?"draft":"ready",invoice_number:invoice.number,request_payload:payload,validation_errors:errors,idempotency_key:body.idempotency_key,request_fingerprint:fingerprint,updated_at:new Date().toISOString()}).eq("id",existing.id).eq("workspace_id",workspaceId).select("*").single();
        if(error) throw new Error("EINVOICE_DRAFT_UPDATE_FAILED");
        return json({ok:true,duplicate:false,record:data},200,origin);
      }
      const {data,error}=await admin.from("workspace_einvoice_records").insert({workspace_id:workspaceId,invoice_id:invoice.id,invoice_number:invoice.number,status:errors.length?"draft":"ready",request_payload:payload,validation_errors:errors,idempotency_key:body.idempotency_key,request_fingerprint:fingerprint,created_by:user.id}).select("*").single();
      if(error) throw new Error("EINVOICE_DRAFT_SAVE_FAILED");
      return json({ok:true,duplicate:false,record:data},201,origin);
    }
    if(action==="prepare_eway_bill") {
      if(!canAccount(role)) return json({error:"Accountant or workspace manager permission required."},403,origin);
      if(!validUuid(body.invoice_id)||!validUuid(body.idempotency_key)) return json({error:"Invoice and idempotency identifiers are required."},400,origin);
      const date=clean(body.document_date,10),distance=body.distance_km,mode=clean(body.transport_mode,10),vehicle=clean(body.vehicle_number,20).toUpperCase(),transporter=clean(body.transporter_id,20).toUpperCase();
      if(!isValidIsoDate(date)||!Number.isInteger(distance)||distance<1||distance>4000||!["road","rail","air","ship"].includes(mode)||(!vehicle&&!transporter)) return json({error:"Document date, distance, transport mode and vehicle or transporter details are required."},400,origin);
      const {data:invoice,error:invoiceError}=await admin.from("invoices").select("id,workspace_id,number,issue_date,status,is_draft,currency,total,invoice_snapshot").eq("id",body.invoice_id).eq("workspace_id",workspaceId).maybeSingle();
      if(invoiceError||!invoice) return json({error:"Invoice not found in this workspace."},404,origin);
      if(invoice.is_draft||["cancelled","void"].includes(String(invoice.status||"").toLowerCase())) return json({error:"Only an issued, active invoice can be prepared for an e-way bill."},409,origin);
      const payload={document_type:"INV",document_number:invoice.number,document_date:date,invoice_date:invoice.issue_date,total_value:Number(invoice.total||0),currency:"INR",distance_km:distance,transport_mode:mode,vehicle_number:vehicle||null,transporter_id:transporter||null};
      const fingerprint=await sha256({invoice_id:invoice.id,payload});
      const {data:active}=await admin.from("workspace_eway_bill_records").select("id,status").eq("workspace_id",workspaceId).eq("invoice_id",invoice.id).in("status",["ready","submitted","generated"]).maybeSingle();
      if(active) return json({error:"An active e-way bill already exists for this invoice."},409,origin);
      const {data:existing}=await admin.from("workspace_eway_bill_records").select("*").eq("workspace_id",workspaceId).eq("invoice_id",invoice.id).in("status",["draft","rejected"]).order("created_at",{ascending:false}).limit(1).maybeSingle();
      if(existing) {
        const {data,error}=await admin.from("workspace_eway_bill_records").update({status:"ready",document_number:invoice.number,document_date:date,distance_km:distance,transport_mode:mode,vehicle_number:vehicle||null,transporter_id:transporter||null,request_payload:payload,validation_errors:[],idempotency_key:body.idempotency_key,request_fingerprint:fingerprint,updated_at:new Date().toISOString()}).eq("id",existing.id).eq("workspace_id",workspaceId).select("*").single();
        if(error) throw new Error("EWAY_DRAFT_UPDATE_FAILED");
        return json({ok:true,duplicate:false,record:data},200,origin);
      }
      const {data,error}=await admin.from("workspace_eway_bill_records").insert({workspace_id:workspaceId,invoice_id:invoice.id,invoice_number:invoice.number,status:"ready",document_type:"INV",document_number:invoice.number,document_date:date,distance_km:distance,transport_mode:mode,vehicle_number:vehicle||null,transporter_id:transporter||null,request_payload:payload,validation_errors:[],idempotency_key:body.idempotency_key,request_fingerprint:fingerprint,created_by:user.id}).select("*").single();
      if(error) throw new Error("EWAY_DRAFT_SAVE_FAILED");
      return json({ok:true,duplicate:false,record:data},201,origin);
    }
    if(action==="configure_provider") {
      if(!canManage(role)) return json({error:"Workspace admin permission required."},403,origin);
      const type=clean(body.provider_type,20),name=clean(body.provider_name,120),environment=clean(body.environment,20),reference=clean(body.secret_reference,100);
      if(!["gst_irp","gstn","tds"].includes(type)||!name||!["sandbox","production"].includes(environment)||!/^PLIVEX_[A-Z0-9_]{3,90}$/.test(reference)) return json({error:"Provider type, name, environment and a Supabase secret-name reference are required. Do not send the secret value."},400,origin);
      const {data,error}=await admin.from("workspace_compliance_provider_connections").upsert({workspace_id:workspaceId,provider_type:type,provider_name:name,environment,status:"awaiting_credentials",secret_reference:reference,configured_by:user.id,updated_at:new Date().toISOString()},{onConflict:"workspace_id,provider_type,environment"}).select("provider_type,provider_name,environment,status,secret_reference").single();
      if(error) throw new Error("PROVIDER_SETUP_SAVE_FAILED");
      return json({ok:true,provider:data,credentials_required:true},200,origin);
    }
    return json({error:"Unsupported compliance action."},400,origin);
  } catch(error) {
    const message=error instanceof Error?error.message:"Unexpected compliance error.";
    const status=message==="AUTH_REQUIRED"?401:message==="WORKSPACE_MEMBERSHIP_REQUIRED"?403:message==="SERVICE_NOT_CONFIGURED"?503:500;
    console.error("India compliance request failed",{message});
    return json({error:status===500?"India compliance service is temporarily unavailable.":message},status,origin);
  }
});
