import {createClient} from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {api,verifyWebhook,activatePaidOrder} from "../_shared/cashfree.ts";
import {isCashfreeRefundEvent,handleCashfreeRefundEvent} from "./refund.ts";
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
Deno.serve(async(req:Request)=>{
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 const raw=await req.text(),signature=req.headers.get("x-webhook-signature")||"",timestamp=req.headers.get("x-webhook-timestamp")||"";
 try{if(!await verifyWebhook(raw,timestamp,signature))return json({error:"Invalid webhook signature"},401);}catch{return json({error:"Webhook verification unavailable"},503);}
 let event:any;try{event=JSON.parse(raw);}catch{return json({error:"Invalid JSON"},400);}
 const data=event?.data||{},payment=data?.payment||{};
 if(isCashfreeRefundEvent(event)){
  const refundOrderId=String(data?.refund?.order_id||data?.order?.order_id||"");
  if(!/^PLXCF-[A-Z0-9]{20,30}$/.test(refundOrderId))return json({received:true,ignored:true});
  const refundUrl=Deno.env.get("SUPABASE_URL"),refundKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!refundUrl||!refundKey)return json({error:"Webhook backend unavailable"},503);
  const refundAdmin=createClient(refundUrl,refundKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:refundOrder,error:refundLookupError}=await refundAdmin.from("subscriptions").select("*").eq("txnid",refundOrderId).maybeSingle();
  if(refundLookupError)return json({error:"Order lookup failed"},503);
  if(!refundOrder)return json({received:true,ignored:true});
  try{
   const refundResponse=await handleCashfreeRefundEvent(event,refundOrder,async(args)=>refundAdmin.rpc("apply_cashfree_refund_event",args));
   return refundResponse||json({received:true,ignored:true});
  }catch(e){console.error("Cashfree refund webhook processing failed",e);return json({error:"Refund reconciliation failed"},503);}
 }
 const orderId=String(data?.order?.order_id||"");
 if(!/^PLXCF-[A-Z0-9]{20,30}$/.test(orderId)||payment?.payment_status!=="SUCCESS")return json({received:true,ignored:true});
 const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!key)return json({error:"Webhook backend unavailable"},503);
 const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:order,error}=await admin.from("subscriptions").select("*").eq("txnid",orderId).maybeSingle();if(error)return json({error:"Order lookup failed"},503);if(!order)return json({received:true,ignored:true});
 try{
  const providerOrder=await api("/orders/"+encodeURIComponent(orderId));
  const result=await activatePaidOrder(admin,order,providerOrder,payment,"cashfree-webhook");
  if(!result.ok&&result.reason!=="order_not_eligible")return json({error:"Payment validation failed"},400);
  return json({received:true,applied:result.ok});
 }catch(e){console.error("Cashfree webhook processing failed",e);return json({error:"Payment update failed"},503);}
});