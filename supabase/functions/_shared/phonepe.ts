export const PLANS = {
 basic_monthly:{id:"basic_monthly",name:"Basic Monthly",tier:"basic",amountPaise:19900,period:"month"},
 pro_monthly:{id:"pro_monthly",name:"Pro Monthly",tier:"pro",amountPaise:24900,period:"month"},
 basic_yearly:{id:"basic_yearly",name:"Basic Yearly",tier:"basic",amountPaise:99900,period:"year"},
 enterprise_yearly:{id:"enterprise_yearly",name:"Enterprise Yearly",tier:"pro",amountPaise:159900,period:"year"},
} as const;
export type PlanId=keyof typeof PLANS;
export const isPlanId=(v:unknown):v is PlanId=>typeof v==="string"&&Object.prototype.hasOwnProperty.call(PLANS,v);
export const addPeriod=(from:Date,period:"month"|"year")=>{const d=new Date(from),day=d.getUTCDate();if(period==="month")d.setUTCMonth(d.getUTCMonth()+1);else d.setUTCFullYear(d.getUTCFullYear()+1);if(d.getUTCDate()!==day)d.setUTCDate(0);return d;};
export const config=()=>{
 const clientId=Deno.env.get("PHONEPE_CLIENT_ID"),clientSecret=Deno.env.get("PHONEPE_CLIENT_SECRET"),clientVersion=Deno.env.get("PHONEPE_CLIENT_VERSION");
 const environment=Deno.env.get("PHONEPE_ENV")==="production"?"production":"sandbox";
 if(!clientId||!clientSecret||!clientVersion)throw new Error("PhonePe test credentials are not configured.");
 const apiBase=environment==="production"?"https://api.phonepe.com/apis/pg":"https://api-preprod.phonepe.com/apis/pg-sandbox";
 return {clientId,clientSecret,clientVersion,environment,apiBase,appBase:(Deno.env.get("APP_BASE_URL")||"https://plivex.in").replace(/\/$/,"")};
};
export const getAccessToken=async(c:ReturnType<typeof config>)=>{
 const form=new URLSearchParams({client_id:c.clientId,client_version:c.clientVersion,client_secret:c.clientSecret,grant_type:"client_credentials"});
 const r=await fetch(c.environment==="production"?"https://api.phonepe.com/apis/identity-manager/v1/oauth/token":"https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:form});
 const d=await r.json().catch(()=>({}));if(!r.ok||typeof d.access_token!=="string"){console.error("PhonePe token request failed",{status:r.status,code:d?.code});throw new Error("PhonePe authorization failed.");}return d.access_token as string;
};
const hex=(b:ArrayBuffer)=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,"0")).join("");
export const sha256=async(s:string)=>hex(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)));
export const safeEqual=(a:string,b:string)=>{if(!a||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;};
export const verifyWebhookAuthorization=async(auth:string|null)=>{
 const user=Deno.env.get("PHONEPE_WEBHOOK_USERNAME"),pass=Deno.env.get("PHONEPE_WEBHOOK_PASSWORD");if(!user||!pass||!auth)return false;
 return safeEqual(auth.trim().replace(/^sha256\s+/i,"").toLowerCase(),await sha256(user+":"+pass));
};
export const safePath=(p:unknown)=>typeof p==="string"&&p.startsWith("/")&&!p.startsWith("//")&&!p.includes("\\")&&p.length<=200?p.split("?")[0]?.split("#")[0]||"/":"/";
export async function activatePayment(admin:any,order:any,payload:any,source:string){
 const amount=Number(payload?.amount);if(payload?.state!=="COMPLETED"||!Number.isFinite(amount)||amount!==Number(order.amount_paise))return {ok:false,reason:"state_or_amount_mismatch"};
 if(order.status==="active")return {ok:true,alreadyApplied:true};if(order.status!=="created"||!isPlanId(order.plan_id))return {ok:false,reason:"order_not_eligible"};
 const now=new Date(),paymentId=payload?.paymentDetails?.find((p:any)=>p?.state==="COMPLETED")?.transactionId||null;
 const {data,error}=await admin.from("subscriptions").update({status:"active",started_at:now.toISOString(),expires_at:addPeriod(now,PLANS[order.plan_id].period).toISOString(),provider_payment_id:paymentId,updated_at:now.toISOString()}).eq("id",order.id).eq("status","created").select("id");
 if(error)throw new Error("Subscription update failed");
 if(!data?.length){const {data:latest}=await admin.from("subscriptions").select("status").eq("id",order.id).maybeSingle();return {ok:latest?.status==="active"};}
 const {error:logError}=await admin.from("payment_logs").insert({user_id:order.user_id,user_email:order.user_email,workspace_id:order.workspace_id,txnid:order.txnid,subscription_id:order.id,provider:"phonepe",gateway:"phonepe",currency:"INR",plan_id:order.plan_id,plan_name:order.plan_name,tier:order.tier,amount,status:"success",outcome:"applied",hash_verified:true,provider_status:payload.state,gateway_status:payload.state,provider_payment_id:paymentId,raw:payload,verified_at:now.toISOString(),reason:null,message:"PhonePe payment verified",source});
 if(logError)console.error("PhonePe payment log failed",{code:logError.code,orderId:order.txnid});return {ok:true};
}
