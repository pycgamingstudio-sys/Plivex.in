export const PLANS = {
  basic_monthly:{id:"basic_monthly",name:"Basic Monthly",tier:"basic",amountPaise:19900,period:"month"},
  pro_monthly:{id:"pro_monthly",name:"Pro Monthly",tier:"pro",amountPaise:24900,period:"month"},
  basic_yearly:{id:"basic_yearly",name:"Basic Yearly",tier:"basic",amountPaise:99900,period:"year"},
  enterprise_yearly:{id:"enterprise_yearly",name:"Enterprise Yearly",tier:"pro",amountPaise:159900,period:"year"},
} as const;
export type PlanId=keyof typeof PLANS;
export const isPlanId=(v:unknown):v is PlanId=>typeof v==="string"&&Object.prototype.hasOwnProperty.call(PLANS,v);
export const addPeriod=(from:Date,period:"month"|"year")=>{const d=new Date(from),day=d.getUTCDate();if(period==="month")d.setUTCMonth(d.getUTCMonth()+1);else d.setUTCFullYear(d.getUTCFullYear()+1);if(d.getUTCDate()!==day)d.setUTCDate(0);return d;};
export const safePath=(p:unknown)=>typeof p==="string"&&p.startsWith("/")&&!p.startsWith("//")&&!p.includes("\\")&&p.length<=200?p.split("?")[0]?.split("#")[0]||"/":"/";
export const origins=new Set(["https://plivex.in","https://www.plivex.in","https://plivex.netlify.app"]);
export const allowedOrigin=(v:unknown,fallback="https://plivex.in")=>typeof v==="string"&&origins.has(v)?v:fallback;
export const config=()=>{
 const appId=Deno.env.get("CASHFREE_APP_ID"),secret=Deno.env.get("CASHFREE_SECRET_KEY");
 const environment=Deno.env.get("CASHFREE_ENV")==="production"?"production":"sandbox";
 if(!appId||!secret)throw new Error("Cashfree credentials are not configured.");
 return {appId,secret,environment,apiBase:environment==="production"?"https://api.cashfree.com/pg":"https://sandbox.cashfree.com/pg",appBase:(Deno.env.get("APP_BASE_URL")||"https://plivex.in").replace(/\/$/,"")};
};
export const api=async(path:string,init:RequestInit={})=>{
 const c=config(),r=await fetch(c.apiBase+path,{...init,headers:{"Content-Type":"application/json","x-api-version":"2023-08-01","x-client-id":c.appId,"x-client-secret":c.secret,...(init.headers||{})}});
 const data=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error("Cashfree API request failed ("+r.status+").");
 return data;
};
export const verifyWebhook=async(raw:string,timestamp:string,signature:string)=>{
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(config().secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const digest=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(timestamp+raw));
 const expected=btoa(String.fromCharCode(...new Uint8Array(digest)));
 if(!signature||signature.length!==expected.length)return false;
 let diff=0;for(let i=0;i<signature.length;i++)diff|=signature.charCodeAt(i)^expected.charCodeAt(i);return diff===0;
};
// Exact decimal major-unit to minor-unit conversion for verified Cashfree refund amounts.
// Reject malformed values and fractions smaller than the currency's minor unit.
export function majorToMinorUnits(value: unknown): number | null {
 if(typeof value!=="number"||!Number.isFinite(value)||value<0)return null;
 const match=value.toString().match(/^(\\d+)(?:\\.(\\d+))?(?:e([+-]?\\d+))?$/i);
 if(!match)return null;
 const fraction=match[2]||"",exponent=Number(match[3]||0);
 let minor=BigInt(match[1]+fraction);
 const shift=exponent-fraction.length+2;
 if(shift>=0)minor*=10n**BigInt(shift);
 else{
  const divisor=10n**BigInt(-shift);
  if(minor%divisor!==0n)return null;
  minor/=divisor;
 }
 if(minor>BigInt(Number.MAX_SAFE_INTEGER))return null;
 return Number(minor);
}

export async function activatePaidOrder(admin:any,order:any,providerOrder:any,payment:any,source:string){
 const expected=Number(order.amount_paise)/100,actual=Number(providerOrder?.order_amount);
 if(providerOrder?.order_status!=="PAID"||!Number.isFinite(actual)||Math.abs(actual-expected)>0.001||payment?.payment_status!=="SUCCESS")return {ok:false,reason:"payment_not_verified"};
 if(order.status==="active")return {ok:true,alreadyApplied:true};
 if(order.status!=="created"||!isPlanId(order.plan_id))return {ok:false,reason:"order_not_eligible"};
 const now=new Date(),paymentId=String(payment?.cf_payment_id||"");
 const {data,error}=await admin.from("subscriptions").update({status:"active",started_at:now.toISOString(),expires_at:addPeriod(now,PLANS[order.plan_id].period).toISOString(),provider_payment_id:paymentId||null,updated_at:now.toISOString()}).eq("id",order.id).eq("status","created").select("id");
 if(error)throw new Error("Subscription update failed");
 if(!data?.length){const {data:latest}=await admin.from("subscriptions").select("status").eq("id",order.id).maybeSingle();return {ok:latest?.status==="active"};}
 const {error:logError}=await admin.from("payment_logs").insert({user_id:order.user_id,user_email:order.user_email,workspace_id:order.workspace_id,txnid:order.txnid,subscription_id:order.id,provider:"cashfree",gateway:"cashfree",currency:"INR",plan_id:order.plan_id,plan_name:order.plan_name,tier:order.tier,amount:Math.round(actual*100),status:"success",outcome:"applied",hash_verified:true,provider_status:payment.payment_status,gateway_status:providerOrder.order_status,provider_payment_id:paymentId||null,raw:{order:providerOrder,payment},verified_at:now.toISOString(),reason:null,message:"Cashfree payment verified",source});
 if(logError)console.error("Cashfree payment log failed",{code:logError.code,orderId:order.txnid});
 return {ok:true};
}
