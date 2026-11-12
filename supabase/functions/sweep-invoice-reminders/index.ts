import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]!));
const validEmail = (value: string) => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
const dateLabel = (value: string) => value
  ? new Date(value + "T00:00:00.000Z").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
  : "";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("MAIL_FROM");
  if (!url || !service) return Response.json({ error: "Scheduler is not configured." }, { status: 503 });
  if (!apiKey || !from) {
    console.error("invoice reminder email service is not configured");
    return Response.json({ error: "Email delivery is not configured. Add RESEND_API_KEY and MAIL_FROM." }, { status: 503 });
  }

  try {
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const supplied = req.headers.get("x-cron-secret") || "";
    const { data: config, error: configError } = await admin.from("invoice_reminder_cron_config")
      .select("secret").eq("singleton", true).maybeSingle();
    if (configError || !config?.secret || supplied.length < 32 || supplied !== config.secret) {
      return Response.json({ error: "Unauthorized scheduler request." }, { status: 401 });
    }

    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const staleBefore = new Date(now.getTime() - 15 * 60 * 1000).toISOString();

    // Recover abandoned claims after a runtime/network interruption.
    // Resend idempotency keys prevent duplicate delivery during safe retries.
    const { error: recoveryError } = await admin.from("invoice_reminder_events")
      .update({ status: "failed", failure_reason: "Previous send attempt timed out; safe retry queued.", updated_at: now.toISOString() })
      .eq("status", "sending").lt("updated_at", staleBefore).lt("attempt_count", 3);
    if (recoveryError) throw recoveryError;

    const { data: dueEvents, error } = await admin.from("invoice_reminder_events")
      .select("id,workspace_id,invoice_id,stage,scheduled_for,schedule_version,attempt_count,recipient_email,status")
      .in("status", ["scheduled", "on_hold", "failed"])
      .lte("scheduled_for", today)
      .lt("attempt_count", 3)
      .order("scheduled_for", { ascending: true })
      .limit(100);
    if (error) throw error;

    let sent = 0, cancelled = 0, failed = 0, skipped = 0;
    for (const event of dueEvents || []) {
      const { data: invoice, error: invoiceError } = await admin.from("invoices")
        .select("id,workspace_id,status,is_draft,reminder_enabled,reminder_hold,reminder_schedule_version,reminder_language,number,client_name,client_email,business_name,currency,total,due_date")
        .eq("id", event.invoice_id).eq("workspace_id", event.workspace_id).maybeSingle();

      if (invoiceError) {
        failed++;
        console.error("reminder invoice lookup failed", event.id, invoiceError.message);
        continue;
      }

      if (!invoice || !invoice.reminder_enabled || invoice.reminder_hold || invoice.is_draft ||
          ["Paid", "Cancelled"].includes(invoice.status) ||
          Number(invoice.reminder_schedule_version || 0) !== Number(event.schedule_version || 0)) {
        const { error: cancelError } = await admin.from("invoice_reminder_events")
          .update({ status: "cancelled", failure_reason: null, updated_at: now.toISOString() })
          .eq("id", event.id).in("status", ["scheduled", "on_hold", "failed"]);
        if (cancelError) failed++; else cancelled++;
        continue;
      }

      const to = String(event.recipient_email || invoice.client_email || "").trim().toLowerCase();
      if (!validEmail(to)) {
        await admin.from("invoice_reminder_events")
          .update({ status: "failed", failure_reason: "Customer email is missing or invalid.", updated_at: now.toISOString() })
          .eq("id", event.id).in("status", ["scheduled", "on_hold", "failed"]);
        failed++;
        continue;
      }

      // Atomic claim prevents overlapping cron invocations from sending the same event.
      const { data: claimed, error: claimError } = await admin.from("invoice_reminder_events")
        .update({ status: "sending", attempt_count: Number(event.attempt_count || 0) + 1, recipient_email: to, failure_reason: null, updated_at: new Date().toISOString() })
        .eq("id", event.id).in("status", ["scheduled", "on_hold", "failed"]).lt("attempt_count", 3)
        .select("id").maybeSingle();
      if (claimError) {
        failed++;
        console.error("reminder claim failed", event.id, claimError.message);
        continue;
      }
      if (!claimed) { skipped++; continue; }

      const hindi = invoice.reminder_language === "hi";
      const amount = Number(invoice.total || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const currency = invoice.currency === "INR" ? "₹" : String(invoice.currency || "₹");
      const due = dateLabel(invoice.due_date || "");
      const stageLabels: Record<string, string> = {
        before_due_2: hindi ? "देय तिथि से 2 दिन पहले" : "2 days before due date",
        due_date: hindi ? "देय तिथि" : "On the due date",
        overdue_3: hindi ? "3 दिन की देरी" : "3 days overdue",
        overdue_7: hindi ? "7 दिन की देरी" : "7 days overdue",
        overdue_15: hindi ? "15 दिन की देरी" : "15 days overdue",
      };
      const clientName = esc(invoice.client_name || (hindi ? "ग्राहक" : "there"));
      const invoiceNumber = esc(invoice.number || "");
      const businessName = esc(invoice.business_name || "Plivex customer");
      const subject = hindi
        ? "भुगतान अनुस्मारक: Invoice " + String(invoice.number || "")
        : "Payment reminder: Invoice " + String(invoice.number || "");
      const html = hindi
        ? '<!doctype html><html lang="hi"><body style="margin:0;background:#fff;font-family:Arial,sans-serif;color:#171717"><div style="max-width:560px;margin:auto;padding:24px"><p>' + businessName + ' की ओर से</p><h2>भुगतान अनुस्मारक</h2><p>नमस्ते ' + clientName + ',</p><p>Invoice <b>' + invoiceNumber + '</b> का भुगतान अभी लंबित दिख रहा है। यह ' + esc(stageLabels[event.stage] || "भुगतान") + ' के लिए एक विनम्र अनुस्मारक है।</p><p>देय राशि: <b>' + esc(currency) + ' ' + esc(amount) + '</b></p>' + (due ? '<p>देय तिथि: <b>' + esc(due) + '</b></p>' : "") + '<p>यदि आपने भुगतान पहले ही कर दिया है, तो कृपया इस संदेश को अनदेखा करें और व्यवसाय से संपर्क करें।</p><p>धन्यवाद।</p></div></body></html>'
        : '<!doctype html><html><body style="margin:0;background:#fff;font-family:Arial,sans-serif;color:#171717"><div style="max-width:560px;margin:auto;padding:24px"><p>From ' + businessName + '</p><h2>Payment reminder</h2><p>Hi ' + clientName + ',</p><p>Payment for invoice <b>' + invoiceNumber + '</b> is still marked as pending. This is a friendly reminder (' + esc(stageLabels[event.stage] || "payment follow-up") + ').</p><p>Amount due: <b>' + esc(currency) + ' ' + esc(amount) + '</b></p>' + (due ? '<p>Due date: <b>' + esc(due) + '</b></p>' : "") + '<p>If you have already paid, please ignore this message and contact the business so the records can be updated.</p><p>Thank you.</p></div></body></html>';

      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + apiKey,
            "Content-Type": "application/json",
            "Idempotency-Key": "plivex-invoice-reminder/" + event.id,
          },
          body: JSON.stringify({ from, to: [to], subject, html }),
        });
        if (!response.ok) {
          const detail = (await response.text()).slice(0, 240);
          await admin.from("invoice_reminder_events")
            .update({ status: "failed", failure_reason: "Email provider rejected the message (HTTP " + response.status + ").", updated_at: new Date().toISOString() })
            .eq("id", event.id).eq("status", "sending");
          console.error("reminder provider rejected", response.status, detail);
          failed++;
          continue;
        }
        const result = await response.json().catch(() => ({}));
        const { error: sentUpdateError } = await admin.from("invoice_reminder_events")
          .update({ status: "sent", sent_at: new Date().toISOString(), provider_message_id: result?.id || null, failure_reason: null, updated_at: new Date().toISOString() })
          .eq("id", event.id).eq("status", "sending");
        if (sentUpdateError) {
          console.error("reminder sent but event update failed", event.id, sentUpdateError.message);
          failed++;
          continue;
        }
        sent++;
        const { data: owner } = await admin.from("workspace_members").select("owner_id")
          .eq("workspace_id", event.workspace_id).eq("role", "admin").not("owner_id", "is", null).limit(1).maybeSingle();
        if (owner?.owner_id) {
          const { error: logError } = await admin.from("activity_logs").insert({
            event_key: crypto.randomUUID(), workspace_id: event.workspace_id, owner_id: owner.owner_id,
            actor_id: owner.owner_id, action: "payment_reminder_sent", outcome: "applied",
            source: "invoice-reminder-scheduler",
            metadata: { invoiceId: event.invoice_id, invoiceNumber: invoice.number, stage: event.stage, recipient: to },
          });
          if (logError) console.error("reminder activity log failed", logError.message);
        }
      } catch (sendError) {
        await admin.from("invoice_reminder_events")
          .update({ status: "failed", failure_reason: "Temporary email delivery error. The scheduler will retry.", updated_at: new Date().toISOString() })
          .eq("id", event.id).eq("status", "sending");
        failed++;
        console.error("reminder email request failed", event.id, sendError instanceof Error ? sendError.message : "unknown error");
      }
    }

    return Response.json({ ok: true, scanned: dueEvents?.length || 0, sent, cancelled, failed, skipped });
  } catch (error) {
    console.error("invoice reminder sweep failed", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Reminder sweep failed." }, { status: 500 });
  }
});