export function createManageCashfreeSubscriptionHandler({ createClient, getEnv, now = () => new Date() }) {
  const allowedOrigins = new Set(["https://plivex.in", "https://www.plivex.in", "https://plivex.netlify.app"]);
  const cors = (origin) => ({
    "Access-Control-Allow-Origin": origin && allowedOrigins.has(origin) ? origin : "https://plivex.in",
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  });
  const json = (body, status, origin) => new Response(JSON.stringify(body), {
    status, headers: { ...cors(origin), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
  return async (req) => {
    const origin = req.headers.get("origin");
    if (origin && !allowedOrigins.has(origin)) return json({ error: "Origin not allowed" }, 403, origin);
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
    const authorization = req.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) return json({ error: "Please sign in." }, 401, origin);
    const url = getEnv("SUPABASE_URL"), anon = getEnv("SUPABASE_ANON_KEY"), service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anon || !service) return json({ error: "Subscription service is not configured." }, 503, origin);
    try {
      const authClient = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
      const { data: { user }, error: authError } = await authClient.auth.getUser();
      if (authError || !user) return json({ error: "Session expired. Sign in again." }, 401, origin);
      const { data: profile, error: profileError } = await authClient.from("profiles").select("workspace_id,role").eq("id", user.id).maybeSingle();
      if (profileError) return json({ error: "Could not verify workspace permissions." }, 500, origin);
      if (!profile?.workspace_id || profile.role !== "admin") return json({ error: "Only the workspace admin can manage subscription cancellation." }, 403, origin);
      const body = await req.json().catch(() => ({})), action = body?.action;
      if (!["cancel", "resume", "status"].includes(action)) return json({ error: "Unsupported subscription action." }, 400, origin);
      const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
      const timestamp = now().toISOString();
      const { data: subscription, error: subscriptionError } = await admin.from("subscriptions")
        .select("id,expires_at,cancel_at_period_end,gateway,provider")
        .eq("workspace_id", profile.workspace_id).eq("gateway", "cashfree").eq("provider", "cashfree")
        .eq("status", "active").lte("started_at", timestamp).gt("expires_at", timestamp)
        .order("expires_at", { ascending: false }).limit(1).maybeSingle();
      if (subscriptionError) return json({ error: "Could not load active subscription." }, 503, origin);
      if (!subscription || String(subscription.gateway || "").toLowerCase() !== "cashfree" || String(subscription.provider || "").toLowerCase() !== "cashfree") {
        if (action === "status") return json({ ok: true, available: false, cancelAtPeriodEnd: false }, 200, origin);
        return json({ error: "No active Cashfree subscription was found for this workspace." }, 404, origin);
      }
      if (action === "status") return json({ ok: true, available: true, cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end), expiresAt: subscription.expires_at }, 200, origin);
      const desired = action === "cancel";
      let update = admin.from("subscriptions").update({
        cancel_at_period_end: desired,
        cancellation_requested_at: desired ? timestamp : null,
        updated_at: timestamp,
      }).eq("id", subscription.id).eq("workspace_id", profile.workspace_id)
        .eq("gateway", "cashfree").eq("provider", "cashfree").eq("status", "active")
        .lte("started_at", timestamp).gt("expires_at", timestamp);
      // Compare-and-set: a competing cancel/resume that read the same state
      // cannot overwrite the first writer. Null is handled explicitly.
      update = subscription.cancel_at_period_end === null
        ? update.is("cancel_at_period_end", null)
        : update.eq("cancel_at_period_end", subscription.cancel_at_period_end);
      const { data: updated, error: updateError } = await update.select("id").maybeSingle();
      if (updateError) return json({ error: "Could not update subscription cancellation." }, 503, origin);
      if (!updated) return json({ error: "Subscription changed. Refresh and try again." }, 409, origin);
      return json({
        ok: true, available: true, action, cancelAtPeriodEnd: desired, expiresAt: subscription.expires_at,
        message: desired
          ? "Cancellation is scheduled for the end of the current paid period. Access remains active until expiry."
          : "Scheduled cancellation was withdrawn.",
      }, 200, origin);
    } catch (error) {
      console.error("manage-cashfree-subscription failed", error);
      return json({ error: "Could not manage subscription." }, 500, origin);
    }
  };
}
