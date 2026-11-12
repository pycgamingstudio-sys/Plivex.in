import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const ORIGINS = new Set(["https://plivex.in", "https://www.plivex.in", "https://plivex.netlify.app"]);
const allowed = (o: string | null) => !o || ORIGINS.has(o) || /^https:\/\/(?:[a-z0-9-]+\.)?[a-z0-9-]+\.(?:pages|workers)\.dev$/.test(o);
const cors = (o: string | null) => ({ "Access-Control-Allow-Origin": o && allowed(o) ? o : "https://plivex.in", "Vary": "Origin", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" });
const json = (b: unknown, s: number, o: string | null) => new Response(JSON.stringify(b), { status: s, headers: { ...cors(o), "Content-Type": "application/json", "Cache-Control": "no-store" } });
const addDays = (iso: string, days: number) => { const d = new Date(iso + "T00:00:00.000Z"); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!allowed(origin)) return json({ error: "Origin not allowed" }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Please sign in." }, 401, origin);
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY"), service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return json({ error: "Reminder service is not configured." }, 503, origin);

  try {
    const userDb = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await userDb.auth.getUser();
    if (authError || !user) return json({ error: "Your session expired. Please sign in again." }, 401, origin);

    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: profile, error: profileError } = await admin.from("profiles").select("role,workspace_id").eq("id", user.id).maybeSingle();
    if (profileError || !profile?.workspace_id) return json({ error: "Workspace not found." }, 403, origin);
    if (!["admin", "manager", "accountant"].includes(profile.role)) return json({ error: "You do not have permission to manage reminders." }, 403, origin);

    const body = await req.json().catch(() => ({}));
    const id = body?.id;
    const enabled = body?.enabled;
    const language = body?.language === "hi" ? "hi" : "en";
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id) || typeof enabled !== "boolean") return json({ error: "Invalid reminder settings." }, 400, origin);

    const { data: invoice, error: invoiceError } = await admin.from("invoices").select("id,workspace_id,status,is_draft,due_date,client_email,client_id,reminder_schedule_version").eq("id", id).eq("workspace_id", profile.workspace_id).maybeSingle();
    if (invoiceError || !invoice) return json({ error: "Invoice not found or access denied." }, 404, origin);
    if (enabled && (invoice.status === "Paid" || invoice.status === "Cancelled" || invoice.is_draft)) return json({ error: "Reminders are only available for active unpaid invoices." }, 409, origin);
    if (enabled && !invoice.due_date) return json({ error: "Add a due date before enabling reminders." }, 400, origin);
    let recipientEmail = String(invoice.client_email || "").trim().toLowerCase();
    if (enabled && !recipientEmail && invoice.client_id) {
      const { data: client } = await admin.from("clients").select("email").eq("id", invoice.client_id).eq("workspace_id", profile.workspace_id).maybeSingle();
      recipientEmail = String(client?.email || "").trim().toLowerCase();
      if (recipientEmail) await admin.from("invoices").update({ client_email: recipientEmail }).eq("id", id).eq("workspace_id", profile.workspace_id);
    }
    if (enabled && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(recipientEmail)) return json({ error: "Add a valid customer email before enabling reminders." }, 400, origin);

    const version = Number(invoice.reminder_schedule_version || 1) + 1;
    const { error: updateError } = await admin.from("invoices").update({
      reminder_enabled: enabled,
      reminder_hold: false,
      reminder_language: language,
      reminder_schedule_version: version,
      updated_at: new Date().toISOString(),
    }).eq("id", id).eq("workspace_id", profile.workspace_id);
    if (updateError) return json({ error: "Could not save reminder settings." }, 500, origin);

    if (!enabled) {
      await admin.from("invoice_reminder_events").update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("invoice_id", id).eq("workspace_id", profile.workspace_id).in("status", ["scheduled", "on_hold", "failed"]);
    } else {
      const stages = [
        ["before_due_2", -2], ["due_date", 0], ["overdue_3", 3], ["overdue_7", 7], ["overdue_15", 15],
      ] as const;
      const today = new Date().toISOString().slice(0, 10);
      const events = stages.map(([stage, offset]) => ({
        workspace_id: profile.workspace_id, invoice_id: id, schedule_version: version,
        stage, scheduled_for: addDays(invoice.due_date, offset),
        status: addDays(invoice.due_date, offset) < today ? "cancelled" : "scheduled",
        recipient_email: recipientEmail,
      }));
      if (events.every((event) => event.scheduled_for < today)) {
        events[4].scheduled_for = today;
        events[4].status = "scheduled";
      }
      const { error: eventError } = await admin.from("invoice_reminder_events").insert(events);
      if (eventError) {
        await admin.from("invoices").update({ reminder_enabled: false }).eq("id", id).eq("workspace_id", profile.workspace_id);
        return json({ error: "Reminder schedule could not be created. The setting was rolled back; please retry." }, 500, origin);
      }
    }

    return json({ ok: true, enabled, scheduleVersion: version }, 200, origin);
  } catch (error) {
    console.error("set-invoice-reminder failed", error instanceof Error ? error.message : "unknown error");
    return json({ error: "Could not update invoice reminder settings." }, 500, origin);
  }
});