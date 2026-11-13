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

const BILLING:Record<string,{currency:string;paymentEnabled:boolean;monthly:{basic:number;pro:number};yearly?:{basic:number;pro:number}}> = {
  IN:{currency:"INR",paymentEnabled:true,monthly:{basic:19900,pro:24900},yearly:{basic:99900,pro:159900}},
  US:{currency:"USD",paymentEnabled:true,monthly:{basic:599,pro:999}},
  GB:{currency:"GBP",paymentEnabled:true,monthly:{basic:499,pro:899}},
  AE:{currency:"AED",paymentEnabled:false,monthly:{basic:1900,pro:3500}},
  CA:{currency:"CAD",paymentEnabled:true,monthly:{basic:799,pro:1299}},
  AU:{currency:"AUD",paymentEnabled:true,monthly:{basic:799,pro:1499}},
  SG:{currency:"SGD",paymentEnabled:true,monthly:{basic:699,pro:1299}},
};
export const CASHFREE_CURRENCIES=new Set(["INR","USD","GBP","CAD","AUD","SGD"]);
export function resolvePlan(planId:PlanId,countryCode:string,email=""){
  const plan=PLANS[planId],country=BILLING[countryCode];
  if(!country)return {available:false,reason:"unsupported_country"} as const;
  if(!country.paymentEnabled||!CASHFREE_CURRENCIES.has(country.currency))return {available:false,reason:"cashfree_currency_unavailable",currency:country.currency} as const;
  if(countryCode!=="IN"&&plan.period!=="month")return {available:false,reason:"billing_period_unavailable",currency:country.currency} as const;
  const price=plan.period==="year"?country.yearly?.[plan.tier]:country.monthly[plan.tier];
  if(!Number.isSafeInteger(price)||price<=0)return {available:false,reason:"plan_unavailable",currency:country.currency} as const;
  // Preserve the existing India-only support/test price exception without exposing it to other editions.
  const amountMinor=countryCode==="IN"&&email.toLowerCase()==="virendra.sharma99978@gmail.com"&&planId==="basic_monthly"?2500:price;
  return {available:true,plan,currency:country.currency,countryCode,amountMinor,period:plan.period} as const;
}

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
 if(!timestamp||!signature)return false;
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(config().secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const digest=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(timestamp+raw));
 const expected=btoa(String.fromCharCode(...new Uint8Array(digest)));
 if(signature.length!==expected.length)return false;
 let diff=0;for(let i=0;i<signature.length;i++)diff|=signature.charCodeAt(i)^expected.charCodeAt(i);return diff===0;
};

export async function activatePaidOrder(admin:any,order:any,providerOrder:any,payment:any,source:string){
 const currency=String(order.currency||"INR").toUpperCase();
 const expected=Number(order.amount_minor_units ?? (currency==="INR"?order.amount_paise:null));
 const actual=Number(providerOrder?.order_amount);
 const actualMinor=Math.round(actual*100);
 const paymentCurrency=String(payment?.payment_currency||payment?.currency||currency).toUpperCase();
 const paymentAmount=payment?.payment_amount===undefined?expected:Math.round(Number(payment.payment_amount)*100);
 if(providerOrder?.order_id!==order.txnid||providerOrder?.order_status!=="PAID"||String(providerOrder?.order_currency||"").toUpperCase()!==currency||
    paymentCurrency!==currency||!Number.isSafeInteger(expected)||actualMinor!==expected||paymentAmount!==expected||payment?.payment_status!=="SUCCESS")
   return {ok:false,reason:"payment_not_verified"};
 if(order.status==="active")return {ok:true,alreadyApplied:true};
 if(order.status!=="created"||!isPlanId(order.plan_id))return {ok:false,reason:"order_not_eligible"};
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
