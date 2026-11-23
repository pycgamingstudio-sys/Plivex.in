import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
const hex=(bytes:ArrayBuffer)=>[...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,"0")).join("");
async function verifySignature(raw:string,header:string,secret:string){
  const supplied=header.startsWith("sha256=")?header.slice(7):"";
  if(!/^[a-f0-9]{64}$/i.test(supplied)) return false;
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const digest=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(raw));
  const expected=hex(digest);
  let mismatch=0;for(let i=0;i<64;i++) mismatch|=expected.charCodeAt(i)^supplied.toLowerCase().charCodeAt(i);
  return mismatch===0;
}
Deno.serve(async(req:Request)=>{
  const url=new URL(req.url);
  if(req.method==="GET"){
    const mode=url.searchParams.get("hub.mode"),token=url.searchParams.get("hub.verify_token"),challenge=url.searchParams.get("hub.challenge");
    if(mode==="subscribe"&&token&&token===Deno.env.get("WHATSAPP_VERIFY_TOKEN")&&challenge) return new Response(challenge,{status:200,headers:{"Content-Type":"text/plain"}});
    return json({error:"Webhook verification failed"},403);
  }
  if(req.method!=="POST") return json({error:"Method not allowed"},405);
  const secret=Deno.env.get("WHATSAPP_APP_SECRET");
  const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),supabaseUrl=Deno.env.get("SUPABASE_URL");
  if(!secret||!service||!supabaseUrl) return json({error:"Webhook is not configured"},503);
  const raw=await req.text();
  if(raw.length>1024*1024) return json({error:"Payload too large"},413);
  if(!await verifySignature(raw,req.headers.get("x-hub-signature-256")||"",secret)) return json({error:"Invalid signature"},401);
  let body:any;try{body=JSON.parse(raw);}catch{return json({error:"Invalid JSON"},400);}
  const admin=createClient(supabaseUrl,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const updates:any[]=[];
  for(const entry of body?.entry||[]) for(const change of entry?.changes||[]) {
    const statuses=change?.value?.statuses||[];
    for(const item of statuses) {
      const id=String(item?.id||"");const status=String(item?.status||"");
      if(!id||!["sent","delivered","read","failed"].includes(status)) continue;
      const errorCode=status==="failed"?String(item?.errors?.[0]?.code||"META_DELIVERY_FAILED"):null;
      const {data,error}=await admin.from("whatsapp_delivery_logs").update({status,error_code:errorCode})
        .eq("provider_message_id",id).select("id,workspace_id,status").maybeSingle();
      if(error) return json({error:"Could not update delivery status"},500);
      if(data) updates.push(data);
    }
  }
  return json({ok:true,updated:updates.length});
});
