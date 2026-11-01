import {createClient} from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {activatePayment,config,getAccessToken} from "../_shared/phonepe.ts";
const dest=(origin:string,path:string,q:Record<string,string>)=>new Response(null,{status:302,headers:{Location:`${origin}${path}?${new URLSearchParams(q)}`,"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
const originSafe=(v:unknown,f:string)=>typeof v==="string"&&["https://plivex.in","https://www.plivex.in","https://plivex.netlify.app"].includes(v)?v:f;
const pathSafe=(v:unknown)=>typeof v==="string"&&v.startsWith("/")&&!v.startsWith("//")&&!v.includes("\\")&&v.length<201?v.split("?")[0]?.split("#")[0]||"/":"/";
Deno.serve(async(req:Request)=>{
 if(req.method!=="GET")return new Response("Method not allowed",{status:405});
 const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!key)return new Response("Verification unavailable",{status:503});
 let cfg;try{cfg=config();}catch{return new Response("Verification unavailable",{status:503});}
 const id=new URL(req.url).searchParams.get("merchantOrderId")||"",admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:order}=await admin.from("subscriptions").select("*").eq("txnid",id).maybeSingle();if(!order)return dest(cfg.appBase,"/",{payment:"failed"});
 const origin=originSafe(order.return_origin,cfg.appBase),path=pathSafe(order.return_path);
 if(order.status==="active")return dest(origin,path,{payment:"success",txnid:id});if(order.status!=="created")return dest(origin,path,{payment:"failed",txnid:id});
 try{
  const token=await getAccessToken(cfg),r=await fetch(`${cfg.apiBase}/checkout/v2/order/${encodeURIComponent(id)}/status?details=false`,{headers:{Authorization:`O-Bearer ${token}`,"Content-Type":"application/json"}});
  const status=await r.json().catch(()=>({}));
  if(r.ok&&status?.state==="COMPLETED"&&Number(status.amount)===Number(order.amount_paise)){const result=await activatePayment(admin,order,status,"phonepe-return");return dest(origin,path,{payment:result.ok?"success":"pending",txnid:id});}
  if(r.ok&&status?.state==="FAILED"){await admin.from("subscriptions").update({status:"failed",updated_at:new Date().toISOString()}).eq("id",order.id).eq("status","created");return dest(origin,path,{payment:"failed",txnid:id});}
  return dest(origin,path,{payment:"pending",txnid:id});
 }catch(e){console.error("PhonePe return verify failed",e);return dest(origin,path,{payment:"pending",txnid:id});}
});