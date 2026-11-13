// Cashfree is the only payment provider for Plivex Global.
// Amounts are stored in minor units; currency is derived from the saved workspace country.
export const PLANS = {
  basic_monthly:{id:"basic_monthly",name:"Basic Monthly",tier:"basic",period:"month"},
  pro_monthly:{id:"pro_monthly",name:"Pro Monthly",tier:"pro",period:"month"},
  basic_yearly:{id:"basic_yearly",name:"Basic Yearly",tier:"basic",period:"year"},
  enterprise_yearly:{id:"enterprise_yearly",name:"Pro Yearly",tier:"pro",period:"year"},
} as const;
export type PlanId=keyof typeof PLANS;
export const isPlanId=(v:unknown):v is PlanId=>typeof v==="string"&&Object.prototype.hasOwnProperty.call(PLANS,v);

import { getBillingForCountry, CASHFREE_CURRENCIES } from "../../../src/global/billing/pricing.js";
const CASHFREE_CURRENCY_SET=new Set(CASHFREE_CURRENCIES);
export function resolvePlan(planId:PlanId,countryCode:string){
  const plan=PLANS[planId],country=getBillingForCountry(countryCode);
  if(!country)return {available:false,reason:"unsupported_country"} as const;
  if(!country.paymentEnabled||!CASHFREE_CURRENCY_SET.has(country.currency))return {available:false,reason:"cashfree_currency_unavailable",currency:country.currency} as const;
  if(countryCode!=="IN"&&plan.period!=="month")return {available:false,reason:"billing_period_unavailable",currency:country.currency} as const;
  const price=plan.period==="year"?country.yearly?.[plan.tier]:country.monthly[plan.tier];
  if(!Number.isSafeInteger(price)||price<=0)return {available:false,reason:"plan_unavailable",currency:country.currency} as const;
  // All customers in the same country and plan receive the same published price.
  const amountMinor=price;
  return {available:true,plan,currency:country.currency,countryCode,amountMinor,period:plan.period} as const;
}

export const createCashfreeOrderId=(randomUUID:()=>string=()=>crypto.randomUUID())=>"PLXCF-"+randomUUID().replaceAll("-","").slice(0,26).toUpperCase();
export const isCashfreeOrderId=(value:unknown):value is string=>typeof value==="string"&&/^PLXCF-[A-Z0-9]{20,30}$/.test(value);

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
export const verifyWebhookSignature=async(raw:string,timestamp:string,signature:string,secret:string)=>{
 if(!timestamp||!signature||!secret)return false;
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const digest=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(timestamp+raw));
 const expected=btoa(String.fromCharCode(...new Uint8Array(digest)));
 if(signature.length!==expected.length)return false;
 let diff=0;for(let i=0;i<signature.length;i++)diff|=signature.charCodeAt(i)^expected.charCodeAt(i);return diff===0;
};
export const verifyWebhook=async(raw:string,timestamp:string,signature:string)=>{
 if(!timestamp||!signature)return false;
 return verifyWebhookSignature(raw,timestamp,signature,config().secret);
};

// Convert a provider major-unit amount to minor units without rounding.
// Cashfree returns JSON numbers; reject strings, non-finite values, negatives,
// fractional minor units, and values outside JavaScript's safe integer range.
export function majorToMinorUnits(value: unknown): number | null {
 if(typeof value!=="number"||!Number.isFinite(value)||value<0)return null;
 const match=value.toString().match(/^(\d+)(?:\\.(\d+))?(?:e([+-]?\d+))?$/i);
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
 const currency=typeof order?.currency==="string"?order.currency.toUpperCase():"";
 const expected=order?.amount_minor_units;
 const actualMinor=majorToMinorUnits(providerOrder?.order_amount);
 const paymentMinor=majorToMinorUnits(payment?.payment_amount);
 const providerOrderCurrency=typeof providerOrder?.order_currency==="string"?providerOrder.order_currency.toUpperCase():"";
 const paymentCurrency=typeof payment?.payment_currency==="string"?payment.payment_currency.toUpperCase():"";
 if(!/^[A-Z]{3}$/.test(currency)||!Number.isSafeInteger(expected)||expected<=0||
    providerOrder?.order_id!==order.txnid||providerOrder?.order_status!=="PAID"||
    !/^[A-Z]{3}$/.test(providerOrderCurrency)||providerOrderCurrency!==currency||
    !/^[A-Z]{3}$/.test(paymentCurrency)||paymentCurrency!==currency||
    actualMinor===null||actualMinor!==expected||paymentMinor===null||paymentMinor!==expected||
    payment?.payment_status!=="SUCCESS")
   return {ok:false,reason:"payment_not_verified"};
 if((order.status!=="created"&&order.status!=="active")||!isPlanId(order.plan_id))return {ok:false,reason:"order_not_eligible"};
 const paymentId=String(payment?.cf_payment_id||"");
 if(!paymentId)return {ok:false,reason:"missing_provider_payment_id"};
 const {data,error}=await admin.rpc("apply_cashfree_subscription_payment",{
   p_subscription_id:order.id,p_provider_payment_id:paymentId,p_currency:currency,
   p_amount_minor:expected,p_provider_order_status:providerOrder.order_status,
   p_provider_payment_status:payment.payment_status,p_raw:{order:providerOrder,payment},
   p_source:source,
 });
 if(error)throw new Error("Atomic payment application failed");
 if(!data?.ok&&data?.reason!=="already_applied")return {ok:false,reason:data?.reason||"payment_not_applied"};
 return {ok:true,alreadyApplied:Boolean(data?.already_applied)};
}
