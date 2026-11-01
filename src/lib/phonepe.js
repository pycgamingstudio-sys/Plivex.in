import {supabase} from "@/api/backendClient";
export async function startPhonePeCheckout({planId}){
 const {data,error}=await supabase.functions.invoke("create-phonepe-order",{body:{planId,origin:window.location.origin,path:window.location.pathname}});
 if(error){let message=error.message||"Could not start PhonePe checkout.";try{const c=error.context;if(c&&typeof c.clone==="function"){const b=await c.clone().json();if(typeof b?.error==="string")message=b.error;}}catch{}throw new Error(message);}
 if(typeof data?.redirectUrl!=="string"||!data.redirectUrl.startsWith("https://"))throw new Error(data?.error||"PhonePe did not return a checkout URL.");
 window.location.assign(data.redirectUrl);
}