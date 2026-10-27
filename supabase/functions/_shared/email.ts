const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const escapeEmailHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export const validEmail = (value: string) => value.length <= 254 && EMAIL_RE.test(value);

export async function sendEmail(input: { to: string; subject: string; html: string }) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("MAIL_FROM");
  if (!apiKey || !from) return { sent: false, reason: "email_not_configured" as const };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [input.to], subject: input.subject.slice(0, 200), html: input.html }),
  });
  if (!response.ok) {
    const text = await response.text();
    console.error("email provider rejected message", { status: response.status, body: text.slice(0, 300) });
    return { sent: false, reason: "provider_error" as const };
  }
  return { sent: true as const };
}
