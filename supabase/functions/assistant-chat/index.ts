import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ASSISTANT_ALLOWED_ORIGIN") || "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Please sign in to use the assistant." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (!supabaseUrl || !anonKey || !geminiKey) {
    console.error("Assistant configuration missing", { supabaseUrl: !!supabaseUrl, anonKey: !!anonKey, geminiKey: !!geminiKey });
    return json({ error: "AI assistant is not configured yet. Please contact support." }, 503);
  }

  try {
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "Your session expired. Please sign in again." }, 401);

    const body = await req.json();
    const incoming = Array.isArray(body?.messages) ? body.messages : [];
    const messages = incoming.slice(-16).map((item: { role?: string; content?: string }) => ({
      role: item?.role === "assistant" ? "model" : "user",
      parts: [{ text: String(item?.content || "").trim().slice(0, 1000) }],
    })).filter((item) => item.parts[0].text.length > 0);
    if (!messages.length || messages[messages.length - 1].role !== "user") {
      return json({ error: "Please enter a message." }, 400);
    }

    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: "You are Plivex AI Assistant, a helpful business software guide. Reply clearly and practically, in the user's language (Hindi/Hinglish or English). Never claim to have read the user's live Plivex invoices, clients, sales, payments, or inventory: this chat currently receives only the conversation, not business records. Do not invent business figures. Do not request passwords, OTPs, API keys, or payment credentials." }] },
        contents: messages,
        generationConfig: { temperature: 0.4, maxOutputTokens: 700 },
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      console.error("Gemini API error", response.status, result?.error?.message || "unknown");
      return json({ error: response.status === 429 ? "AI usage limit reached. Please try again shortly." : "Gemini could not answer right now. Please try again." }, response.status === 429 ? 429 : 502);
    }
    const reply = result?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || "").join("").trim();
    if (!reply) return json({ error: "Gemini returned no text. Please try again." }, 502);
    return json({ reply });
  } catch (error) {
    console.error("Assistant request failed", error);
    return json({ error: "Something went wrong while contacting the AI assistant." }, 500);
  }
});
