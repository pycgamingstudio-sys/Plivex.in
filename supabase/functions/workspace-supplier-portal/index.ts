import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const origins=new Set(["https://plivex.in","https://www.plivex.in","https://plivex.netlify.app"]);
const allowed=(o:string|null)=>!o||origins.has(o);
const cors=(o:string|null)=>({"Access-Control-Allow-Origin":o&&allowed(o)?o:"https://plivex.in","Vary":"Origin","Access-Control-Allow-Headers":"authorization,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS"});
const json=(v:unknown,status=200,o:string|null=null)=>new Response(JSON.stringify(v),{status,headers:{...cors(o),"Content-Type":"application/json","Cache-Control":"no-store"}});
const enc=new TextEncoder();
const clean=(v:unknown,max=300)=>String(v??"").trim().slice(0,max);
const sha=async(v:string)=>{const d=await crypto.subtle.digest("SHA-256",enc.encode(v));return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,"0")).join("");};
const newToken=()=>{const b=crypto.getRandomValues(new Uint8Array(32));return btoa(String.fromCharCode(...b)).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");};
const escapeHtml=(v:string)=>v.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]||c));
async function context(req:Request){
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!anon||!service)throw new Error("SERVICE_NOT_CONFIGURED");
 const auth=req.headers.get("Authorization")||"";if(!auth.startsWith("Bearer "))throw new Error("AUTH_REQUIRED");
 const client=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false}});
 const {data:{user},error}=await client.auth.getUser();if(error||!user)throw new Error("AUTH_REQUIRED");
 const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:profile,error:pe}=await admin.from("profiles").select("workspace_id,role").eq("id",user.id).maybeSingle();
 if(pe||!profile?.workspace_id)throw new Error("WORKSPACE_NOT_FOUND");
 const {data:settings,error:se}=await admin.from("workspace_settings").select("workspace_id,country_code,currency_code").eq("workspace_id",profile.workspace_id).maybeSingle();
 if(se||!settings)throw new Error("WORKSPACE_NOT_READY");
 const {data:member}=await admin.from("workspace_members").select("role,status").eq("workspace_id",profile.workspace_id).eq("user_id",user.id).eq("status","active").maybeSingle();
 return {admin,user,workspaceId:String(profile.workspace_id),settings,role:String(member?.role||profile.role||"")};
}
const canManage=(r:string)=>["admin","manager"].includes(r);
async function sendInvite(email:string,name:string,link:string){
 const subject="Complete your supplier onboarding for Plivex";
 const html=`<p>Hello ${escapeHtml(name)},</p><p>Please complete your supplier profile using the secure one-time link below. The link expires in 7 days.</p><p><a href="${escapeHtml(link)}">Complete supplier onboarding</a></p><p>If you were not expecting this request, you can ignore this email.</p>`;
 const text=`Hello ${name},\nComplete your supplier onboarding using this secure one-time link (expires in 7 days):\n${link}\nIf you were not expecting this request, ignore this email.`;
 const brevo=Deno.env.get("BREVO_API_KEY"),resend=Deno.env.get("RESEND_API_KEY");
 if(brevo&&Deno.env.get("BREVO_FROM_EMAIL")){
  const response=await fetch("https://api.brevo.com/v3/smtp/email",{method:"POST",headers:{"api-key":brevo,"Content-Type":"application/json"},body:JSON.stringify({sender:{email:Deno.env.get("BREVO_FROM_EMAIL"),name:Deno.env.get("BREVO_FROM_NAME")||"Plivex"},to:[{email}],subject,htmlContent:html,textContent:text})});
  if(response.ok)return "brevo";
 }
 if(resend&&Deno.env.get("RESEND_FROM_EMAIL")){
  const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:"Bearer "+resend,"Content-Type":"application/json"},body:JSON.stringify({from:Deno.env.get("RESEND_FROM_EMAIL"),to:[email],subject,html,text})});
  if(response.ok)return "resend";
 }
 return "copy_link";
}
async function publicPreview(admin:any,secret:string){
 if(secret.length<30)throw new Error("INVITE_NOT_FOUND");
 const {data:invite,error}=await admin.from("supplier_invitation_tokens").select("id,workspace_id,supplier_id,expires_at,used_at,revoked_at").eq("token_hash",await sha(secret)).maybeSingle();
 if(error||!invite||invite.used_at||invite.revoked_at||new Date(invite.expires_at).getTime()<=Date.now())throw new Error("INVITE_NOT_ACTIVE");
 const [{data:supplier},{data:settings}]=await Promise.all([
  admin.from("suppliers").select("supplier_name,contact_email,status,tax_country_code").eq("workspace_id",invite.workspace_id).eq("id",invite.supplier_id).maybeSingle(),
  admin.from("workspace_settings").select("country_code").eq("workspace_id",invite.workspace_id).maybeSingle()
 ]);
 if(!supplier||!settings)throw new Error("INVITE_NOT_FOUND");
 return {ok:true,supplier:{name:supplier.supplier_name,email:supplier.contact_email,status:supplier.status},workspaceCountry:settings.country_code,expiresAt:invite.expires_at};
}
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get("origin");if(!allowed(origin))return json({error:"Origin not allowed"},403,origin);
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
 if(req.method!=="POST")return json({error:"Method not allowed"},405,origin);
 try{
  const body=await req.json().catch(()=>({}));if(!body||typeof body!=="object"||Array.isArray(body))return json({error:"Invalid request"},400,origin);
  const action=clean(body.action,80);
  if(action==="portal.preview"||action==="portal.submit"){
   const url=Deno.env.get("SUPABASE_URL")!,service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
   const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
   const secret=clean(body.token,256);const preview=await publicPreview(admin,secret);
   if(action==="portal.preview")return json(preview,200,origin);
   const phone=clean(body.phone,32),taxCountry=clean(body.taxCountryCode,3).toUpperCase(),taxId=clean(body.taxId,80);
   const paymentTerms=clean(body.paymentTerms,200),address=body.address;
   if(!isValidAddress(address)||phone.length>32||paymentTerms.length>200||taxCountry!==String(preview.workspaceCountry).toUpperCase())throw new Error("INVALID_SUPPLIER_PROFILE");
   const {data:submitted,error:submitError}=await admin.rpc("submit_main_workspace_supplier_profile",{p_token_hash:await sha(secret),p_phone:phone,p_tax_country_code:taxCountry,p_tax_id:taxId||null,p_address:address,p_payment_terms:paymentTerms});
   if(submitError||!submitted?.ok)throw new Error(submitted?.reason||"SUPPLIER_SUBMIT_FAILED");
   return json({ok:true},200,origin);
  }
  const ctx=await context(req);if(!canManage(ctx.role))throw new Error("ACCESS_DENIED");
  if(action==="invite.list"){
   const {data,error}=await ctx.admin.from("suppliers").select("id,supplier_name,contact_email,phone,tax_country_code,tax_id,address,payment_terms,status,submitted_at,reviewed_at,review_note,created_at").eq("workspace_id",ctx.workspaceId).order("created_at",{ascending:false}).limit(100);
   if(error)throw new Error("SUPPLIER_LIST_FAILED");return json({ok:true,suppliers:data||[]},200,origin);
  }
  if(action==="invite.create"){
   const name=clean(body.supplierName,200),email=clean(body.email,254).toLowerCase();
   if(name.length<2||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error("INVALID_SUPPLIER");
   let supplier:any;
   const {data:existing}=await ctx.admin.from("suppliers").select("id,status").eq("workspace_id",ctx.workspaceId).eq("contact_email",email).maybeSingle();
   if(existing){
    if(["approved","archived"].includes(existing.status))throw new Error("SUPPLIER_ALREADY_EXISTS");
    const {data,error}=await ctx.admin.from("suppliers").update({supplier_name:name,status:"invited",updated_at:new Date().toISOString()}).eq("id",existing.id).select("id").single();
    if(error)throw new Error("SUPPLIER_UPDATE_FAILED");supplier=data;
   }else{
    const {data,error}=await ctx.admin.from("suppliers").insert({workspace_id:ctx.workspaceId,supplier_name:name,contact_email:email,status:"invited",created_by:ctx.user.id}).select("id").single();
    if(error)throw new Error("SUPPLIER_CREATE_FAILED");supplier=data;
   }
   await ctx.admin.from("supplier_invitation_tokens").update({revoked_at:new Date().toISOString()}).eq("supplier_id",supplier.id).is("used_at",null).is("revoked_at",null);
   const raw=newToken(),expires=new Date(Date.now()+7*86400000).toISOString();
   const {error:tokenError}=await ctx.admin.from("supplier_invitation_tokens").insert({workspace_id:ctx.workspaceId,supplier_id:supplier.id,token_hash:await sha(raw),expires_at:expires,created_by:ctx.user.id});
   if(tokenError)throw new Error("SUPPLIER_INVITE_CREATE_FAILED");
   const base=(Deno.env.get("PLIVEX_APP_URL")||"https://plivex.in").replace(/\/$/,""),link=base+"/supplier-onboarding/"+raw;
   const provider=await sendInvite(email,name,link);
   await ctx.admin.from("workspace_audit_events").insert({workspace_id:ctx.workspaceId,actor_id:ctx.user.id,action:"supplier.invitation_created",entity_type:"supplier",entity_id:supplier.id,metadata:{email,provider,expires_at:expires}});
   return json({ok:true,supplierId:supplier.id,inviteUrl:link,expiresAt:expires,emailProvider:provider},200,origin);
  }
  if(action==="invite.revoke"){
   const supplierId=clean(body.supplierId,64);
   const {data,error}=await ctx.admin.from("supplier_invitation_tokens").update({revoked_at:new Date().toISOString()}).eq("workspace_id",ctx.workspaceId).eq("supplier_id",supplierId).is("used_at",null).is("revoked_at",null).select("id");
   if(error||!data?.length)throw new Error("INVITE_NOT_FOUND");
   await ctx.admin.from("workspace_audit_events").insert({workspace_id:ctx.workspaceId,actor_id:ctx.user.id,action:"supplier.invitation_revoked",entity_type:"supplier",entity_id:supplierId,metadata:{}});
   return json({ok:true},200,origin);
  }
  if(action==="supplier.review"){
   const supplierId=clean(body.supplierId,64),status=body.status==="approved"?"approved":body.status==="rejected"?"rejected":"";
   if(!status)throw new Error("INVALID_REVIEW");
   const {data,error}=await ctx.admin.from("suppliers").update({status,reviewed_by:ctx.user.id,reviewed_at:new Date().toISOString(),review_note:clean(body.reviewNote,1000)||null,updated_at:new Date().toISOString()}).eq("workspace_id",ctx.workspaceId).eq("id",supplierId).eq("status","submitted").select("id").maybeSingle();
   if(error||!data)throw new Error("SUPPLIER_REVIEW_FAILED");
   await ctx.admin.from("workspace_audit_events").insert({workspace_id:ctx.workspaceId,actor_id:ctx.user.id,action:"supplier.profile_"+status,entity_type:"supplier",entity_id:supplierId,metadata:{review_note:clean(body.reviewNote,1000)}});
   return json({ok:true},200,origin);
  }
  throw new Error("UNKNOWN_ACTION");
 }catch(error){
  const code=error instanceof Error?error.message:"REQUEST_FAILED";
  const status=code==="AUTH_REQUIRED"?401:code==="ACCESS_DENIED"?403:code.includes("NOT_FOUND")?404:code.includes("INVALID")?400:code.includes("NOT_CONFIGURED")?503:500;
  return json({ok:false,error:code},status,origin);
 }
});
function isValidAddress(v:unknown):v is Record<string,unknown>{
 if(!v||typeof v!=="object"||Array.isArray(v))return false;
 const obj=v as Record<string,unknown>;return Object.keys(obj).length<=12&&Object.entries(obj).every(([k,val])=>k.length<=40&&typeof val==="string"&&val.length<=300);
}
