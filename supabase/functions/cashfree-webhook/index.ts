import {createClient} from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {api,verifyWebhook,activatePaidOrder} from "../_shared/cashfree.ts";
import {isCashfreeOrderId,cashfreePaymentStatusUpdateFilter} from "../_shared/cashfree.ts";
import {handleCashfreeRefundEvent} from "./refund.ts";
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
Deno.serve(async(req:Request)=>{
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 const raw=await req.text(),signature=req.headers.get("x-webhook-signature")||"",timestamp=req.headers.get("x-webhook-timestamp")||"";
 try{if(!await verifyWebhook(raw,timestamp,signature))return json({error:"Invalid webhook signature"},401);}
 catch{return json({error:"Webhook verification unavailable"},503);}
 let event:any;try{event=JSON.parse(raw);}catch{return json({error:"Invalid JSON"},400);}
 const data=event?.data||{},orderId=String(data?.order?.order_id||data?.refund?.order_id||""),payment=data?.payment||{};
 if(!isCashfreeOrderId(orderId))return json({received:true,ignored:true});
 const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!key)return json({error:"Webhook backend unavailable"},503);
 const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:order,error}=await admin.from("subscriptions").select("*").eq("txnid",orderId).maybeSingle();
 if(error)return json({error:"Order lookup failed"},503);
 if(!order)return json({received:true,ignored:true});

 const refundResponse=await handleCashfreeRefundEvent(event,order,async(args)=>admin.rpc("apply_cashfree_refund_event",args));
 if(refundResponse)return refundResponse;

 const paymentStatus=String(payment?.payment_status||"").toUpperCase();
 if(paymentStatus!=="SUCCESS"){
  const normalized=paymentStatus==="FAILED"?"failed":paymentStatus==="PENDING"?"pending":null;
  if(normalized) {
   // Cashfree deliveries are at-least-once and may arrive out of order.
   // PENDING can only fill an unset/created/pending state. FAILED may advance
   // those states, but neither can overwrite SUCCESS or an active subscription.
   const allowedPriorStates=cashfreePaymentStatusUpdateFilter(normalized);
   const {error:updateError}=await admin.from("subscriptions").update({
    payment_status:normalized,provider_payment_status:paymentStatus,
    provider_order_status:String(data?.order?.order_status||"").toUpperCase()||null,
    updated_at:new Date().toISOString()
   }).eq("id",order.id).eq("status","created").or(allowedPriorStates);
   if(updateError)return json({error:"Payment status update failed"},503);
  }
  return json({received:true,updated:Boolean(normalized)});
 }
 try{
  const providerOrder=await api("/orders/"+encodeURIComponent(orderId));
  const result=await activatePaidOrder(admin,order,providerOrder,payment,"cashfree-webhook");
  if(!result.ok)return json({error:"Verified payment could not be applied",reason:result.reason},503);
  return json({received:true,applied:!result.alreadyApplied});
 }catch(e){console.error("Cashfree webhook processing failed",e);return json({error:"Payment update failed"},503);}
});
