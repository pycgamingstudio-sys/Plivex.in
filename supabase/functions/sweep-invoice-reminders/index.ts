import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !service) return Response.json({ error: "Scheduler is not configured." }, { status: 503 });
  try {
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const supplied = req.headers.get("x-cron-secret") || "";
    const { data: config, error: configError } = await admin.from("invoice_reminder_cron_config").select("secret").eq("singleton", true).maybeSingle();
    if (configError || !config?.secret || supplied.length < 32 || supplied !== config.secret) {
      return Response.json({ error: "Unauthorized scheduler request." }, { status: 401 });
    }
    const today = new Date().toISOString().slice(0, 10);
    const { data: dueEvents, error } = await admin.from("invoice_reminder_events")
      .select("id,workspace_id,invoice_id,stage,scheduled_for")
      .eq("status", "scheduled").lte("scheduled_for", today).order("scheduled_for", { ascending: true }).limit(200);
    if (error) throw error;
    let held = 0, cancelled = 0, failed = 0;
    for (const event of dueEvents || []) {
      const { data: invoice, error: invoiceError } = await admin.from("invoices")
        .select("id,workspace_id,status,is_draft,reminder_enabled,reminder_hold,number,client_name")
        .eq("id", event.invoice_id).eq("workspace_id", event.workspace_id).maybeSingle();
      if (invoiceError) { failed++; continue; }
      if (!invoice || !invoice.reminder_enabled || invoice.reminder_hold || invoice.is_draft || ["Paid", "Cancelled"].includes(invoice.status)) {
        const { error: cancelError } = await admin.from("invoice_reminder_events").update({ status: "cancelled", updated_at: new Date().toISOString() })
          .eq("id", event.id).eq("status", "scheduled");
        if (cancelError) failed++; else cancelled++;
        continue;
      }
      const { data: changed, error: holdError } = await admin.from("invoice_reminder_events")
        .update({ status: "on_hold", updated_at: new Date().toISOString() })
        .eq("id", event.id).eq("status", "scheduled").select("id").maybeSingle();
      if (holdError) { failed++; continue; }
      if (!changed) continue;
      held++;
      const { data: owner } = await admin.from("workspace_members").select("owner_id")
        .eq("workspace_id", event.workspace_id).eq("role", "admin").not("owner_id", "is", null).limit(1).maybeSingle();
      if (owner?.owner_id) {
        const { error: logError } = await admin.from("activity_logs").insert({
          event_key: crypto.randomUUID(), workspace_id: event.workspace_id, owner_id: owner.owner_id,
          actor_id: owner.owner_id, action: "payment_confirmation_required", outcome: "applied",
          source: "invoice-reminder-scheduler", metadata: { invoiceId: event.invoice_id, invoiceNumber: invoice.number, stage: event.stage }
        });
        if (logError) console.error("reminder activity log failed", logError.message);
      }
    }
    return Response.json({ ok: true, scanned: dueEvents?.length || 0, waitingForConfirmation: held, cancelled, failed });
  } catch (error) {
    console.error("invoice reminder sweep failed", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Reminder sweep failed." }, { status: 500 });
  }
});