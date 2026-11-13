import {createClient} from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {api,verifyWebhook,activatePaidOrder} from "../_shared/cashfree.ts";
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
Deno.serve(async(req:Request)=>{
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 const raw=await req.text(),signature=req.headers.get("x-webhook-signature")||"",timestamp=req.headers.get("x-webhook-timestamp")||"";
 try{if(!await verifyWebhook(raw,timestamp,signature))return json({error:"Invalid webhook signature"},401);}
 catch{return json({error:"Webhook verification unavailable"},503);}
 let event:any;try{event=JSON.parse(raw);}catch{return json({error:"Invalid JSON"},400);}
 const data=event?.data||{},orderId=String(data?.order?.order_id||data?.refund?.order_id||""),payment=data?.payment||{};
 if(!/^PLXCF-[A-Z0-9]{20,30}$/.test(orderId))return json({received:true,ignored:true});
 const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!key)return json({error:"Webhook backend unavailable"},503);
 const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:order,error}=await admin.from("subscriptions").select("*").eq("txnid",orderId).maybeSingle();
 if(error)return json({error:"Order lookup failed"},503);
 if(!order)return json({received:true,ignored:true});

 const refund=data?.refund||{};
 const eventType=String(event?.type||event?.event_type||"").toUpperCase();
 if(eventType.includes("REFUND")||refund?.refund_id||refund?.cf_refund_id){
  const refundId=String(refund?.cf_refund_id||refund?.refund_id||"");
  const refundStatus=String(refund?.refund_status||"").toUpperCase();
  const refundAmount=Number(refund?.refund_amount??refund?.amount);
  const {data:priorRefund,error:priorRefundError}=await admin.from("payment_refunds").select("status")
   .eq("provider","cashfree").eq("provider_refund_id",refundId).maybeSingle();
  if(priorRefundError)return json({error:"Refund replay check failed"},503);
  if(priorRefund?.status==="success"&&refundStatus!=="SUCCESS")
   return json({received:true,ignored:true,reason:"refund_already_finalized"});
  const refundMinor=Math.round(refundAmount*100);
  if(!refundId||!["SUCCESS","PENDING","FAILED","CANCELLED"].includes(refundStatus)||!Number.isSafeInteger(refundMinor)||refundMinor<=0)
   return json({error:"Invalid refund event"},400);
  if(refundMinor>Number(order.amount_minor_units??order.amount_paise??0))return json({error:"Refund exceeds original payment amount"},400);
  const {error:refundWriteError}=await admin.from("payment_refunds").upsert({
   subscription_id:order.id,user_id:order.user_id,workspace_id:order.workspace_id,
   provider:"cashfree",provider_refund_id:refundId,amount_minor_units:refundMinor,
   currency:String(order.currency||"INR").toUpperCase(),
   status:refundStatus==="CANCELLED"?"failed":refundStatus.toLowerCase(),raw:event,updated_at:new Date().toISOString()
  },{onConflict:"provider,provider_refund_id"});
  if(refundWriteError)return json({error:"Refund ledger update failed"},503);
  const {data:refundRows,error:sumError}=await admin.from("payment_refunds").select("amount_minor_units").eq("subscription_id",order.id).eq("status","success");
  if(sumError)return json({error:"Refund reconciliation failed"},503);
  const totalRefunded=(refundRows||[]).reduce((sum:any,item:any)=>sum+Number(item.amount_minor_units||0),0);
  const originalAmount=Number(order.amount_minor_units??order.amount_paise??0);
  if(totalRefunded>originalAmount)return json({error:"Cumulative refunds exceed original payment amount"},409);
  const fullyRefunded=totalRefunded>=originalAmount;
  const nextRefundStatus=fullyRefunded?"success":totalRefunded>0?"partially_refunded":refundStatus.toLowerCase();
  const {error:subscriptionRefundError}=await admin.from("subscriptions").update({
   refund_status:nextRefundStatus,
   payment_status:fullyRefunded?"refunded":totalRefunded>0?"partially_refunded":(order.payment_status||"success"),
   refunded_at:fullyRefunded?new Date().toISOString():null,
   status:fullyRefunded?"failed":order.status,
   updated_at:new Date().toISOString()
  }).eq("id",order.id);
  if(subscriptionRefundError)return json({error:"Subscription refund reconciliation failed"},503);
  const {error:logRefundError}=await admin.from("payment_logs").update({refund_status:nextRefundStatus,refund_amount_minor_units:totalRefunded})
   .eq("subscription_id",order.id).eq("provider","cashfree");
  if(logRefundError)return json({error:"Payment log refund update failed"},503);
  return json({received:true,refundStatus:nextRefundStatus,refundedMinorUnits:totalRefunded});
 }

 const paymentStatus=String(payment?.payment_status||"").toUpperCase();
 if(paymentStatus!=="SUCCESS"){
  const normalized=paymentStatus==="FAILED"?"failed":paymentStatus==="PENDING"?"pending":null;
  if(normalized) {
   const {error:updateError}=await admin.from("subscriptions").update({
    payment_status:normalized,provider_payment_status:paymentStatus,
    provider_order_status:String(data?.order?.order_status||"").toUpperCase()||null,
    updated_at:new Date().toISOString()
   }).eq("id",order.id).eq("status","created");
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
