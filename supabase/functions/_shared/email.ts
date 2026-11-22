const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const escapeEmailHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export const validEmail = (value: string) => value.length <= 254 && EMAIL_RE.test(value);

function senderDetails(from: string) {
  const match = from.match(/^\s*"?([^"<]*)"?\s*<([^<>]+)>\s*$/);
  const email = (match ? match[2] : from).trim();
  const name = (Deno.env.get("MAIL_FROM_NAME") || (match ? match[1] : "") || "Plivex").trim().slice(0, 80);
  return validEmail(email) ? { email, name } : null;
}

/**
 * Provider order is deterministic: Brevo first when configured, otherwise
 * Resend. Credentials are server-only Supabase Edge Function secrets.
 */
export async function sendEmail(input: { to: string; subject: string; html: string }) {
  if (!validEmail(input.to)) return { sent: false, reason: "invalid_recipient" as const };
  const from = Deno.env.get("MAIL_FROM") || "";
  const sender = senderDetails(from);
  if (!sender) return { sent: false, reason: "email_not_configured" as const };

  const brevoKey = Deno.env.get("BREVO_API_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const subject = input.subject.slice(0, 200);

  if (brevoKey) {
    try {
      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": brevoKey, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ sender, to: [{ email: input.to }], subject, htmlContent: input.html }),
      });
      if (!response.ok) {
        const body = await response.text();
        console.error("Brevo rejected email", { status: response.status, body: body.slice(0, 300) });
        return { sent: false, reason: "provider_error" as const, provider: "brevo" as const };
      }
      return { sent: true as const, provider: "brevo" as const };
    } catch (error) {
      console.error("Brevo email request failed", error instanceof Error ? error.message : "unknown error");
      return { sent: false, reason: "provider_error" as const, provider: "brevo" as const };
    }
  }

  if (!resendKey) return { sent: false, reason: "email_not_configured" as const };
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [input.to], subject, html: input.html }),
    });
    if (!response.ok) {
      const body = await response.text();
      console.error("Resend rejected email", { status: response.status, body: body.slice(0, 300) });
      return { sent: false, reason: "provider_error" as const, provider: "resend" as const };
    }
    return { sent: true as const, provider: "resend" as const };
  } catch (error) {
    console.error("Resend email request failed", error instanceof Error ? error.message : "unknown error");
    return { sent: false, reason: "provider_error" as const, provider: "resend" as const };
  }
}
