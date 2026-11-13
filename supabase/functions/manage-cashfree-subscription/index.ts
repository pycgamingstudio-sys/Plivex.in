import {createClient} from "https://esm.sh/@supabase/supabase-js@2.45.4";
const ORIGINS=new Set(["https://plivex.in","https://www.plivex.in","https://plivex.netlify.app"]);
const cors=(origin:string|null)=>({"Access-Control-Allow-Origin":origin&&ORIGINS.has(origin)?origin:"https://plivex.in","Vary":"Origin","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"});
const json=(body:unknown,status:number,origin:string|null)=>new Response(JSON.stringify(body),{status,headers:{...cors(origin),"Content-Type":"application/json","Cache-Control":"no-store"}});
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get("origin");
 if(origin&&!ORIGINS.has(origin))return json({error:"Origin not allowed"},403,origin);
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
 if(req.method!=="POST")return json({error:"Method not allowed"},405,origin);
 const authorization=req.headers.get("Authorization");
 if(!authorization?.startsWith("Bearer "))return json({error:"Please sign in."},401,origin);
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!anon||!service)return json({error:"Subscription service is not configured."},503,origin);
 try{
  const authClient=createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:authError}=await authClient.auth.getUser();
  if(authError||!user)return json({error:"Session expired. Sign in again."},401,origin);
  const {data:profile,error:profileError}=await authClient.from("profiles").select("workspace_id,role").eq("id",user.id).maybeSingle();
  if(profileError)return json({error:"Could not verify workspace permissions."},500,origin);
  if(!profile?.workspace_id||profile.role!=="admin")return json({error:"Only the workspace admin can manage subscription cancellation."},403,origin);
  const body=await req.json().catch(()=>({}));
  const action=body?.action;
  if(action!=="cancel"&&action!=="resume")return json({error:"Unsupported subscription action."},400,origin);
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:subscription,error:subscriptionError}=await admin.from("subscriptions").select("id,expires_at,cancel_at_period_end")
   .eq("workspace_id",profile.workspace_id).eq("status","active").gt("expires_at",new Date().toISOString())
   .order("expires_at",{ascending:false}).limit(1).maybeSingle();
  if(subscriptionError)return json({error:"Could not load active subscription."},503,origin);
  if(!subscription)return json({error:"No active paid subscription was found for this workspace."},404,origin);
  const requestedAt=action==="cancel"?new Date().toISOString():null;
  const {error:updateError}=await admin.from("subscriptions").update({
   cancel_at_period_end:action==="cancel",
   cancellation_requested_at:requestedAt,
   updated_at:new Date().toISOString()
  }).eq("id",subscription.id).eq("workspace_id",profile.workspace_id).eq("status","active");
  if(updateError)return json({error:"Could not update subscription cancellation."},503,origin);
  return json({ok:true,action,expiresAt:subscription.expires_at,message:action==="cancel"?"Cancellation is scheduled for the end of the current paid period. Access remains active until expiry.":"Scheduled cancellation was withdrawn."},200,origin);
 }catch(error){console.error("manage-cashfree-subscription failed",error);return json({error:"Could not manage subscription."},500,origin);}
});
