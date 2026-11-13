import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const ORIGINS = new Set(["https://plivex.in", "https://www.plivex.in", "https://plivex.netlify.app"]);
const allowed = (o: string | null) => !o || ORIGINS.has(o);
const cors = (o: string | null) => ({ "Access-Control-Allow-Origin": o && allowed(o) ? o : "https://plivex.in", "Vary": "Origin", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" });
const json = (b: unknown, s: number, o: string | null) => new Response(JSON.stringify(b), { status:s, headers:{...cors(o),"Content-Type":"application/json","Cache-Control":"no-store"} });
const sha256 = async (value:string) => { const bytes = new TextEncoder().encode(value); const digest = await crypto.subtle.digest("SHA-256",bytes); return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,"0")).join(""); };
const token = () => { const bytes = crypto.getRandomValues(new Uint8Array(32)); return [...bytes].map(v=>v.toString(16).padStart(2,"0")).join(""); };
Deno.serve(async (req:Request) => {
 const origin=req.headers.get("origin"); if(!allowed(origin)) return json({error:"Origin not allowed"},403,origin);
 if(req.method==="OPTIONS") return new Response("ok",{headers:cors(origin)});
 if(req.method!=="POST") return json({error:"Method not allowed"},405,origin);
 const url=Deno.env.get("SUPABASE_URL"), anon=Deno.env.get("SUPABASE_ANON_KEY"), service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!anon||!service) return json({error:"Invoice sharing is not configured."},503,origin);
 try {
  const body=await req.json().catch(()=>({})); const action=String(body.action||"");
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  if(action==="public_view"||action==="track") {
   const raw=String(body.token||""); if(!/^[a-f0-9]{64}$/.test(raw)) return json({error:"This invoice link is invalid or unavailable."},404,origin);
   const hash=await sha256(raw);
   const {data:link,error:linkError}=await admin.from("invoice_share_links").select("id,invoice_id,workspace_id,expires_at,revoked_at").eq("token_hash",hash).maybeSingle();
   if(linkError||!link||link.revoked_at||new Date(link.expires_at)<=new Date()) return json({error:"This invoice link has expired or was revoked."},404,origin);
   const {data:allowedRequest,error:limitError}=await admin.rpc("consume_invoice_share_rate_limit",{
    p_share_link_id:link.id,
    p_action:action,
    p_max_requests:action==="track"?30:60,
   });
   if(limitError){console.error("invoice share rate limit unavailable",limitError);return json({error:"Invoice link is temporarily unavailable. Please try again shortly."},503,origin);}
   if(!allowedRequest)return json({error:"Too many requests for this invoice link. Please try again in a minute."},429,origin);
   if(action==="track") {
    const event=body.event==="download"?"download":"view";
    const rpc=event==="download"?"increment_invoice_share_download":"record_invoice_share_view";
    const {error}=await admin.rpc(rpc,{share_link_id:link.id});
    if(error){console.error("invoice share tracking failed",error);return json({error:"Could not record invoice activity."},503,origin);}
    return json({ok:true},200,origin);
   }
   const {data:invoice,error:invoiceError}=await admin.from("invoices").select("number,client_name,business_name,issue_date,due_date,currency,status,subtotal,cgst,sgst,igst,total,invoice_snapshot,invoice_items(id,description,quantity,rate)").eq("id",link.invoice_id).eq("workspace_id",link.workspace_id).maybeSingle();
   if(invoiceError||!invoice) return json({error:"Invoice is no longer available."},404,origin);
   const {error:viewError}=await admin.rpc("record_invoice_share_view",{share_link_id:link.id});
   if(viewError){console.error("invoice share view tracking failed",viewError);return json({error:"Could not load invoice activity."},503,origin);}
   const snapshot=invoice.invoice_snapshot&&typeof invoice.invoice_snapshot==="object"?invoice.invoice_snapshot:{};
   const business=snapshot.business&&typeof snapshot.business==="object"?snapshot.business:{};
   const client=snapshot.client&&typeof snapshot.client==="object"?snapshot.client:{};
   const publicSnapshot={
    business:{name:business.name,address:business.address,gstin:business.gstin,locale:business.locale,countryLocale:business.countryLocale},
    client:{name:client.name,company:client.company,address:client.address,gstin:client.gstin},
    items:Array.isArray(snapshot.items)?snapshot.items.map((item:Record<string,unknown>)=>({
     id:item.id,description:item.description,quantity:item.quantity,rate:item.rate,gstRate:item.gstRate,
    })) : [],
    notes:snapshot.notes,
    terms:snapshot.terms,
   };
   return json({invoice:{...invoice,invoice_snapshot:publicSnapshot}},200,origin);
  }
  const authorization=req.headers.get("Authorization");
  if(!authorization?.startsWith("Bearer ")) return json({error:"Please sign in."},401,origin);
  const userClient=createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:authError}=await userClient.auth.getUser();
  if(authError||!user) return json({error:"Please sign in again."},401,origin);
  if(action==="create") {
   const invoiceId=String(body.invoiceId||""); if(!/^[0-9a-f-]{36}$/i.test(invoiceId)) return json({error:"Invalid invoice."},400,origin);
   const {data:invoice,error}=await userClient.from("invoices").select("id,workspace_id").eq("id",invoiceId).maybeSingle();
   if(error||!invoice) return json({error:"Invoice not found or access denied."},404,origin);
   const raw=token(), hash=await sha256(raw);
   const {error:insertError}=await admin.from("invoice_share_links").insert({invoice_id:invoice.id,workspace_id:invoice.workspace_id,created_by:user.id,token_hash:hash});
   if(insertError) { console.error("share link insert failed",insertError); return json({error:"Could not create invoice link."},500,origin); }
   return json({url:"https://plivex.in/i/"+raw,expiresInDays:30},200,origin);
  }
  if(action==="list") {
   const {data:links,error}=await admin.from("invoice_share_links").select("id,invoice_id,created_at,expires_at,revoked_at,last_viewed_at,view_count,download_count,invoices(number,client_name,total,currency)").eq("created_by",user.id).order("created_at",{ascending:false}).limit(100);
   if(error) { console.error("share link list failed",error); return json({error:"Could not load shared invoices."},500,origin); }
   return json({links:links||[]},200,origin);
  }
  if(action==="revoke") {
   const linkId=String(body.linkId||""); if(!/^[0-9a-f-]{36}$/i.test(linkId)) return json({error:"Invalid share link."},400,origin);
   const {data:link}=await admin.from("invoice_share_links").select("id,created_by").eq("id",linkId).maybeSingle();
   if(!link||link.created_by!==user.id) return json({error:"Share link not found."},404,origin);
   const {error}=await admin.from("invoice_share_links").update({revoked_at:new Date().toISOString()}).eq("id",linkId);
   if(error) return json({error:"Could not revoke link."},500,origin);
   return json({ok:true},200,origin);
  }
  return json({error:"Unsupported action."},400,origin);
 } catch(error) { console.error("invoice-share error",error); return json({error:"Invoice sharing failed. Please try again."},500,origin); }
});
