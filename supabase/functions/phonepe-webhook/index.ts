import {createClient} from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {activatePayment,verifyWebhookAuthorization} from "../_shared/phonepe.ts";
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
Deno.serve(async(req:Request)=>{
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 const raw=await req.text();if(!(await verifyWebhookAuthorization(req.headers.get("authorization"))))return json({error:"Unauthorized"},401);
 let event:any;try{event=JSON.parse(raw);}catch{return json({error:"Invalid JSON"},400);}
 const payload=event?.payload||{};if(event?.event!=="checkout.order.completed"||payload?.state!=="COMPLETED")return json({received:true,ignored:true});
 const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!key)return json({error:"Webhook backend unavailable"},503);
 const merchantOrderId=String(payload?.merchantOrderId||"");if(!/^PLX-[A-Z0-9]{20,40}$/.test(merchantOrderId))return json({received:true,ignored:true});
 const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:order,error}=await admin.from("subscriptions").select("*").eq("txnid",merchantOrderId).maybeSingle();if(error)return json({error:"Order lookup failed"},503);if(!order)return json({received:true,ignored:true});
 const merchantId=Deno.env.get("PHONEPE_MERCHANT_ID");if(merchantId&&payload?.merchantId!==merchantId)return json({error:"Merchant mismatch"},401);
 try{const result=await activatePayment(admin,order,payload,"phonepe-webhook");if(!result.ok&&result.reason!=="order_not_eligible")return json({error:"Payment validation failed"},400);return json({received:true,applied:result.ok});}catch{return json({error:"Payment update failed"},503);}
});