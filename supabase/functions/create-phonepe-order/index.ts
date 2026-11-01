import {createClient} from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {config,getAccessToken,isPlanId,PLANS,safePath} from "../_shared/phonepe.ts";
const origins=new Set(["https://plivex.in","https://www.plivex.in","https://plivex.netlify.app"]);
const cors=(o:string|null)=>({"Access-Control-Allow-Origin":o&&origins.has(o)?o:"https://plivex.in","Vary":"Origin","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"});
const json=(b:unknown,s:number,o:string|null)=>new Response(JSON.stringify(b),{status:s,headers:{...cors(o),"Content-Type":"application/json","Cache-Control":"no-store"}});
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get("origin");if(req.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});if(req.method!=="POST")return json({error:"Method not allowed"},405,origin);
 const auth=req.headers.get("Authorization");if(!auth?.startsWith("Bearer "))return json({error:"Please sign in before paying."},401,origin);
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!anon||!service)return json({error:"Payment service is not configured."},503,origin);
 let cfg;try{cfg=config();}catch(e){return json({error:(e as Error).message,code:"PHONEPE_NOT_CONFIGURED"},503,origin);}
 try{
  const authClient=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:authError}=await authClient.auth.getUser();if(authError||!user)return json({error:"Session expired. Sign in again."},401,origin);
  const body=await req.json().catch(()=>({}));if(!isPlanId(body?.planId))return json({error:"Invalid plan."},400,origin);
  const {data:profile,error:profileError}=await authClient.from("profiles").select("email,full_name,workspace_id").eq("id",user.id).maybeSingle();if(profileError)return json({error:"Could not load profile."},500,origin);
  const email=String(profile?.email||user.email||"").trim();if(!email)return json({error:"Account email is missing."},400,origin);
  const plan=PLANS[body.planId],merchantOrderId="PLX-"+crypto.randomUUID().replaceAll("-","").slice(0,28).toUpperCase();
  const returnOrigin=origins.has(body?.origin)?body.origin:cfg.appBase,returnPath=safePath(body?.path);
  const returnUrl=`${url.replace(/\/$/,"")}/functions/v1/phonepe-return?merchantOrderId=${encodeURIComponent(merchantOrderId)}`;
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const {error:insertError}=await admin.from("subscriptions").insert({user_id:user.id,user_email:email,workspace_id:profile?.workspace_id||null,plan:plan.id,plan_id:plan.id,plan_name:plan.name,tier:plan.tier,status:"created",amount:Math.round(plan.amountPaise/100),amount_paise:plan.amountPaise,currency:"INR",gateway:"phonepe",provider:"phonepe",txnid:merchantOrderId,return_origin:returnOrigin,return_path:returnPath});
  if(insertError){console.error("PhonePe subscription insert failed",{code:insertError.code});return json({error:"Could not create payment order."},500,origin);}
  const token=await getAccessToken(cfg),r=await fetch(`${cfg.apiBase}/checkout/v2/pay`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`O-Bearer ${token}`},body:JSON.stringify({merchantOrderId,amount:plan.amountPaise,expireAfter:1200,paymentFlow:{type:"PG_CHECKOUT",message:`Plivex ${plan.name}`,merchantUrls:{redirectUrl:returnUrl}},metaInfo:{udf1:user.id,udf2:plan.id}})});
  const result=await r.json().catch(()=>({}));if(!r.ok||typeof result?.redirectUrl!=="string"){await admin.from("subscriptions").update({status:"failed",updated_at:new Date().toISOString()}).eq("txnid",merchantOrderId).eq("status","created");console.error("PhonePe create order failed",{status:r.status,code:result?.code});return json({error:"PhonePe could not start checkout. Try again."},502,origin);}
  return json({environment:cfg.environment,merchantOrderId,redirectUrl:result.redirectUrl},200,origin);
 }catch(e){console.error("create-phonepe-order failed",e);return json({error:"Could not start PhonePe checkout."},500,origin);}
});