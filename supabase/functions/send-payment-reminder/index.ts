import { authenticate, corsHeaders, isAllowedOrigin, jsonResponse } from "../_shared/team.ts";
import { escapeEmailHtml, sendEmail, validEmail } from "../_shared/email.ts";

const text = (value: unknown, max = 200) => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : "";
function safeInvoiceUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 2000) return "";
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password) return "";
    if (u.hostname !== "plivex.in" && u.hostname !== "www.plivex.in" && !u.hostname.endsWith(".supabase.co")) return "";
    return u.toString();
  } catch { return ""; }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!isAllowedOrigin(origin)) return jsonResponse({ error: "Origin not allowed" }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, origin);
  try {
    const auth = await authenticate(req);
    if ("error" in auth) return jsonResponse({ error: auth.error, operation: "send-payment-reminder" }, auth.status, origin);
    const { data: profile, error: profileError } = await auth.admin.from("profiles").select("role,workspace_id").eq("id", auth.user.id).maybeSingle();
    if (profileError || !profile?.workspace_id) return jsonResponse({ error: "Workspace not found" }, 403, origin);
    if (!["admin", "manager", "accountant"].includes(profile.role)) return jsonResponse({ error: "You do not have permission to send payment reminders." }, 403, origin);

    const body = await req.json().catch(() => ({}));
    const to = typeof body?.to === "string" ? body.to.trim().toLowerCase() : "";
    if (!validEmail(to)) return jsonResponse({ error: "Invalid email" }, 400, origin);
    const clientName = text(body.clientName, 100);
    const invoiceNumber = text(body.invoiceNumber, 60);
    const amount = typeof body.amount === "number" && Number.isFinite(body.amount) ? body.amount.toFixed(2) : text(body.amount, 30);
    const dueDate = text(body.dueDate, 40);
    const pdfLink = safeInvoiceUrl(body.pdfLink);
    const esc = escapeEmailHtml;
    const html = `<!doctype html><html><body style="margin:0;background:#fff;font-family:Arial,sans-serif;color:#171717"><div style="max-width:560px;margin:auto;padding:24px"><h2>Payment reminder</h2><p>Hi ${esc(clientName || "there")},</p><p>This is a friendly reminder that payment${invoiceNumber ? ` for invoice <b>${esc(invoiceNumber)}</b>` : ""} is due${dueDate ? ` on <b>${esc(dueDate)}</b>` : ""}.</p>${amount ? `<p>Amount due: <b>₹${esc(amount)}</b></p>` : ""}${pdfLink ? `<p><a href="${esc(pdfLink)}">View invoice</a></p>` : ""}<p>If you have already paid, please ignore this message.</p><p>Thank you.</p></div></body></html>`;
    const subject = invoiceNumber ? `Payment reminder: invoice ${invoiceNumber}` : "Payment reminder";
    const result = await sendEmail({ to, subject, html });
    if (!result.sent) return jsonResponse({ ok: false, emailSent: false, error: result.reason === "email_not_configured" ? "Email delivery is not configured. Set RESEND_API_KEY and MAIL_FROM in Supabase Edge Function secrets." : "Email provider could not send the reminder." }, result.reason === "email_not_configured" ? 503 : 502, origin);
    const { data: ownerRow } = await auth.admin.from("workspace_members").select("owner_id").eq("workspace_id", profile.workspace_id).eq("role", "admin").not("owner_id", "is", null).limit(1).maybeSingle();
    if (ownerRow?.owner_id) await auth.admin.from("activity_logs").insert({ event_key: crypto.randomUUID(), workspace_id: profile.workspace_id, owner_id: ownerRow.owner_id, actor_id: auth.user.id, action: "payment_reminder_sent", outcome: "applied", source: "send-payment-reminder", metadata: { to, invoiceNumber: invoiceNumber || null } });
    return jsonResponse({ ok: true, emailSent: true, sentTo: to }, 200, origin);
  } catch (error) {
    console.error("send-payment-reminder failed", error instanceof Error ? error.message : "unknown error");
    return jsonResponse({ error: "Could not send payment reminder." }, 500, origin);
  }
});
