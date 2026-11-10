import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const ORIGINS = new Set(["https://plivex.in","https://www.plivex.in","https://plivex.netlify.app"]);
const allowed=(o:string|null)=>!o||ORIGINS.has(o)||/^https:\/\/(?:[a-z0-9-]+\.)?[a-z0-9-]+\.(?:pages|workers)\.dev$/.test(o);
const cors=(o:string|null)=>({"Access-Control-Allow-Origin":o&&allowed(o)?o:"https://plivex.in","Vary":"Origin","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"});
const json=(b:unknown,s:number,o:string|null)=>new Response(JSON.stringify(b),{status:s,headers:{...cors(o),"Content-Type":"application/json","Cache-Control":"no-store"}});
const esc=(v:string)=>v.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
const validEmail=(v:string)=>v.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get("origin");
 if(!allowed(origin))return json({error:"Origin not allowed"},403,origin);
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
 if(req.method!=="POST")return json({error:"Method not allowed"},405,origin);
 const authorization=req.headers.get("Authorization");
 if(!authorization?.startsWith("Bearer "))return json({error:"Please sign in."},401,origin);
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!anon||!service)return json({error:"Reminder service is not configured."},503,origin);
 try{
  const userDb=createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:authError}=await userDb.auth.getUser();
  if(authError||!user)return json({error:"Your session expired. Please sign in again."},401,origin);
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:profile}=await admin.from("profiles").select("role,workspace_id").eq("id",user.id).maybeSingle();
  if(!profile?.workspace_id||!["admin","manager","accountant"].includes(profile.role))return json({error:"You do not have permission to send reminders."},403,origin);
  const body=await req.json().catch(()=>({}));
  const eventId=body?.eventId;
  if(typeof eventId!=="string"||!/^[0-9a-f-]{36}$/i.test(eventId))return json({error:"Invalid reminder event."},400,origin);
  const {data:event,error:eventError}=await admin.from("invoice_reminder_events").select("*").eq("id",eventId).eq("workspace_id",profile.workspace_id).maybeSingle();
  if(eventError||!event)return json({error:"Reminder event not found."},404,origin);
  if(!["on_hold","scheduled","failed"].includes(event.status))return json({error:"This reminder has already been processed."},409,origin);
  if(String(event.scheduled_for)>new Date().toISOString().slice(0,10))return json({error:"This reminder is not due yet."},409,origin);
  const {data:invoice,error:invoiceError}=await admin.from("invoices").select("*").eq("id",event.invoice_id).eq("workspace_id",profile.workspace_id).maybeSingle();
  if(invoiceError||!invoice)return json({error:"Invoice not found."},404,origin);
  if(!invoice.reminder_enabled||invoice.reminder_hold||["Paid","Cancelled"].includes(invoice.status)||invoice.is_draft){
   await admin.from("invoice_reminder_events").update({status:"cancelled",updated_at:new Date().toISOString()}).eq("id",eventId);
   return json({error:"Invoice is no longer eligible for a reminder."},409,origin);
  }
  const to=String(invoice.client_email||"").trim().toLowerCase();
  if(!validEmail(to))return json({error:"Customer email is missing or invalid."},400,origin);
  const {data:claimed,error:claimError}=await admin.from("invoice_reminder_events").update({status:"sending",attempt_count:Number(event.attempt_count||0)+1,recipient_email:to,updated_at:new Date().toISOString()})
    .eq("id",eventId).eq("workspace_id",profile.workspace_id).in("status",["on_hold","scheduled","failed"]).select("id").maybeSingle();
  if(claimError||!claimed)return json({error:"This reminder is already being processed."},409,origin);
  const apiKey=Deno.env.get("RESEND_API_KEY"),from=Deno.env.get("MAIL_FROM");
  if(!apiKey||!from){
   await admin.from("invoice_reminder_events").update({status:"failed",failure_reason:"Email delivery is not configured.",updated_at:new Date().toISOString()}).eq("id",eventId);
   return json({error:"Email delivery is not configured."},503,origin);
  }
  const due=invoice.due_date?new Date(invoice.due_date+"T00:00:00.000Z").toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric",timeZone:"UTC"}):"";
  const amount=Number(invoice.total||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
  const hindi=invoice.reminder_language==="hi";
  const html=hindi
    ? `<!doctype html><html lang="hi"><body style="margin:0;background:#fff;font-family:Arial,sans-serif;color:#171717"><div style="max-width:560px;margin:auto;padding:24px"><h2>भुगतान अनुस्मारक</h2><p>नमस्ते ${esc(String(invoice.client_name||"ग्राहक"))},</p><p>यह invoice <b>${esc(String(invoice.number||""))}</b> के भुगतान के लिए एक विनम्र अनुस्मारक है। हमारे रिकॉर्ड में भुगतान अभी लंबित दिख रहा है।</p><p>देय राशि: <b>${esc(String(invoice.currency==="INR"?"₹":invoice.currency||"₹"))} ${esc(amount)}</b></p>${due?`<p>देय तिथि: <b>${esc(due)}</b></p>`:""}<p>यदि आपने भुगतान पहले ही कर दिया है, तो कृपया इस संदेश को अनदेखा करें और रिकॉर्ड अपडेट कराने के लिए हमसे संपर्क करें।</p><p>धन्यवाद।</p></div></body></html>`
    : `<!doctype html><html><body style="margin:0;background:#fff;font-family:Arial,sans-serif;color:#171717"><div style="max-width:560px;margin:auto;padding:24px"><h2>Payment reminder</h2><p>Hi ${esc(String(invoice.client_name||"there"))},</p><p>This is a friendly reminder that payment for invoice <b>${esc(String(invoice.number||""))}</b> is still marked as pending.</p><p>Amount due: <b>${esc(String(invoice.currency==="INR"?"₹":invoice.currency||"₹"))} ${esc(amount)}</b></p>${due?`<p>Due date: <b>${esc(due)}</b></p>`:""}<p>If you have already paid, please ignore this message and contact us so the records can be updated.</p><p>Thank you.</p></div></body></html>`;
  const subject=hindi?`भुगतान अनुस्मारक: invoice ${String(invoice.number||"")}`:`Payment reminder: invoice ${String(invoice.number||"")}`;
  const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({from,to:[to],subject,html})});
  if(!response.ok){
   const detail=(await response.text()).slice(0,240);
   await admin.from("invoice_reminder_events").update({status:"failed",failure_reason:"Email provider rejected the message.",updated_at:new Date().toISOString()}).eq("id",eventId);
   console.error("reminder provider rejected",response.status,detail);
   return json({error:"Email provider could not send the reminder."},502,origin);
  }
  const result=await response.json().catch(()=>({}));
  await admin.from("invoice_reminder_events").update({status:"sent",sent_at:new Date().toISOString(),provider_message_id:result?.id||null,failure_reason:null,updated_at:new Date().toISOString()}).eq("id",eventId);
  return json({ok:true,emailSent:true,sentTo:to},200,origin);
 }catch(error){
  console.error("confirm-payment-reminder failed",error instanceof Error?error.message:"unknown error");
  return json({error:"Could not send payment reminder."},500,origin);
 }
});