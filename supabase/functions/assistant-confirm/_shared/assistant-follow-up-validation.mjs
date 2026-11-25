const clean = (value, max) => String(value ?? "").trim().slice(0, max);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateLeadFollowUpAction(action, now = Date.now()) {
  if (!action || typeof action !== "object" || clean(action.type, 50) !== "schedule_lead_follow_up") return null;
  const raw = action.payload && typeof action.payload === "object" ? action.payload : {};
  const leadId = clean(raw.lead_id, 36);
  const dueAt = clean(raw.due_at, 40);
  const body = clean(raw.body, 1000);
  const timestamp = Date.parse(dueAt);
  if (!UUID_RE.test(leadId) || !Number.isFinite(timestamp) || timestamp <= now || body.length < 2) return null;
  return { type: "schedule_lead_follow_up", payload: { lead_id: leadId, due_at: new Date(timestamp).toISOString(), body } };
}
