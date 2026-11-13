import {createClient} from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {api,activatePaidOrder,origins,safePath} from "../_shared/cashfree.ts";
const appBase=()=> (Deno.env.get("APP_BASE_URL")||"https://plivex.in").replace(/\/$/,"");
const admin=()=>createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
const redirect=(origin:string,params:Record<string,string>)=>new Response(null,{status:302,headers:{Location:origin+"/payment-result?"+new URLSearchParams(params),"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
Deno.serve(async(req:Request)=>{
 if(req.method!=="GET")return new Response("Method not allowed",{status:405});
 const id=new URL(req.url).searchParams.get("order_id")||"";
 try{
  if(!/^PLXCF-[A-Z0-9]{20,30}$/.test(id))return redirect(appBase(),{payment:"failed",next:"/pricing"});
  const db=admin(),{data:row,error}=await db.from("subscriptions").select("*").eq("txnid",id).maybeSingle();
  if(error||!row)return redirect(appBase(),{payment:"failed",next:"/pricing"});
  const origin=typeof row.return_origin==="string"&&origins.has(row.return_origin)?row.return_origin:appBase();
  const next=safePath(row.return_path);
  let status="pending";
  try{
   const providerOrder=await api("/orders/"+encodeURIComponent(id));
   const payments=await api("/orders/"+encodeURIComponent(id)+"/payments");
   const payment=Array.isArray(payments)?payments.find((item:any)=>item.payment_status==="SUCCESS"):null;
   if(payment){
    const result=await activatePaidOrder(db,row,providerOrder,payment,"cashfree-return");
    if(result.ok)status="success";
   }else if(["EXPIRED","TERMINATED","FAILED"].includes(String(providerOrder?.order_status||"").toUpperCase())){
    status="failed";
    await db.from("subscriptions").update({payment_status:"failed",provider_order_status:providerOrder.order_status,updated_at:new Date().toISOString()}).eq("id",row.id).eq("status","created");
   }else{
    await db.from("subscriptions").update({payment_status:"pending",provider_order_status:String(providerOrder?.order_status||"").toUpperCase()||null,updated_at:new Date().toISOString()}).eq("id",row.id).eq("status","created");
   }
  }catch(e){console.error("Cashfree return verification",e);}
  const amount=String(row.amount_minor_units??row.amount_paise??"");
  return redirect(origin,{payment:status,txnid:id,amount,currency:String(row.currency||"INR"),plan:String(row.plan_name||row.plan_id||""),next});
 }catch(e){console.error("cashfree-return failed",e);return redirect(appBase(),{payment:"pending",next:"/dashboard"});}
});
