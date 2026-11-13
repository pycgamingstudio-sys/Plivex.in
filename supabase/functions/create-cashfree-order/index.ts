import {createClient} from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {api,config,isPlanId,resolvePlan,safePath,allowedOrigin} from "../_shared/cashfree.ts";
const cors=(o:string|null)=>({"Access-Control-Allow-Origin":o&&["https://plivex.in","https://www.plivex.in","https://plivex.netlify.app"].includes(o)?o:"https://plivex.in","Vary":"Origin","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"});
const json=(b:unknown,s:number,o:string|null)=>new Response(JSON.stringify(b),{status:s,headers:{...cors(o),"Content-Type":"application/json","Cache-Control":"no-store"}});
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get("origin");
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
 if(req.method!=="POST")return json({error:"Method not allowed"},405,origin);
 const auth=req.headers.get("Authorization");
 if(!auth?.startsWith("Bearer "))return json({error:"Please sign in before paying."},401,origin);
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!anon||!service)return json({error:"Payment service is not configured."},503,origin);
 const supabaseBase=url.endsWith("/")?url.slice(0,-1):url;
 try{config();}catch(e){return json({error:(e as Error).message,code:"CASHFREE_NOT_CONFIGURED"},503,origin);}
 try{
  const authClient=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:authError}=await authClient.auth.getUser();
  if(authError||!user)return json({error:"Session expired. Sign in again."},401,origin);
  const body=await req.json().catch(()=>({}));
  if(!isPlanId(body?.planId))return json({error:"Invalid plan."},400,origin);
  const {data:profile,error:profileError}=await authClient.from("profiles").select("email,full_name,workspace_id").eq("id",user.id).maybeSingle();
  if(profileError)return json({error:"Could not load profile."},500,origin);
  const email=String(profile?.email||user.email||"").trim();
  if(!email)return json({error:"Account email is missing."},400,origin);
  if(!profile?.workspace_id)return json({error:"Your account is not linked to a workspace yet."},409,origin);
  const {data:business,error:businessError}=await authClient.from("business_profile").select("country_code,locale_code").eq("workspace_id",profile.workspace_id).maybeSingle();
  if(businessError)return json({error:"Could not verify workspace billing country."},500,origin);
  // Legacy workspaces without an explicit country retain India billing. New
  // international workspaces must explicitly save their country in settings.
  const countryCode=String(business?.country_code||"IN").toUpperCase();
  const plan=resolvePlan(body.planId,countryCode,email);
  if(!plan.available){
    if(plan.reason==="cashfree_currency_unavailable")return json({error:"Cashfree checkout is not yet enabled for "+plan.currency+". Your plan price is saved, but payment will open only after the merchant account confirms this currency.",code:"CURRENCY_NOT_ENABLED"},409,origin);
    return json({error:"This plan is not available for the selected workspace country.",code:"PLAN_NOT_AVAILABLE"},409,origin);
  }
  const rawPhone=String(user.phone||user.user_metadata?.phone||user.user_metadata?.phone_number||"");
  const phone=rawPhone.replace(/[^0-9]/g,"");
  if(countryCode==="IN"?!/^[0-9]{10}$/.test(phone):! /^[0-9]{8,15}$/.test(phone))
    return json({error:"Add a valid mobile number to your Plivex account before checkout."},400,origin);
  const amountMinor=plan.amountMinor,currency=plan.currency;
  const orderId="PLXCF-"+crypto.randomUUID().replaceAll("-","").slice(0,26).toUpperCase();
  const returnOrigin=allowedOrigin(body?.origin),returnPath=safePath(body?.path);
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const {error:insertError}=await admin.from("subscriptions").insert({
    user_id:user.id,user_email:email,workspace_id:profile.workspace_id,
    plan:plan.plan.id,plan_id:plan.plan.id,plan_name:plan.plan.name,tier:plan.plan.tier,
    status:"created",payment_status:"created",
    amount:Math.round(amountMinor/100),amount_minor_units:amountMinor,amount_major:amountMinor/100,
    amount_paise:currency==="INR"?amountMinor:null,currency,country_code:countryCode,
    billing_period:plan.period,idempotency_key:orderId,
    gateway:"cashfree",provider:"cashfree",txnid:orderId,
    return_origin:returnOrigin,return_path:returnPath
  });
  if(insertError){console.error("Cashfree subscription insert failed",{code:insertError.code});return json({error:"Could not create payment order."},500,origin);}
  try{
   const result=await api("/orders",{method:"POST",body:JSON.stringify({
     order_id:orderId,order_amount:amountMinor/100,order_currency:currency,
     customer_details:{customer_id:user.id.replaceAll("-","").slice(0,32),customer_name:String(profile?.full_name||user.user_metadata?.full_name||"Plivex Customer").slice(0,100),customer_email:email,customer_phone:phone},
     order_meta:{return_url:supabaseBase+"/functions/v1/cashfree-return?order_id={order_id}",notify_url:supabaseBase+"/functions/v1/cashfree-webhook"}
   })});
   if(typeof result?.payment_session_id!=="string")throw new Error("Cashfree did not return a payment session.");
   return json({orderId,paymentSessionId:result.payment_session_id,environment:config().environment,currency,amountMinor,countryCode},200,origin);
  }catch(e){
   await admin.from("subscriptions").update({status:"failed",payment_status:"failed",updated_at:new Date().toISOString()}).eq("txnid",orderId).eq("status","created");
   console.error("Cashfree order create failed",e);
   return json({error:"Cashfree could not start checkout. Please try again."},502,origin);
  }
 }catch(e){console.error("create-cashfree-order failed",e);return json({error:"Could not start Cashfree checkout."},500,origin);}
});
