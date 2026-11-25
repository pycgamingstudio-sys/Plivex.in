const clean = (value, max) => String(value ?? "").trim().slice(0, max);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const STAFF_ROLES = new Set(["manager", "employee", "storekeeper", "accountant"]);

export function validateStaffInviteAction(action) {
  if (!action || typeof action !== "object" || clean(action.type, 40) !== "invite_staff") return null;
  const raw = action.payload && typeof action.payload === "object" ? action.payload : {};
  const email = clean(raw.email, 254).toLowerCase();
  const name = clean(raw.name, 100);
  const role = clean(raw.role, 32).toLowerCase();
  if (!EMAIL_RE.test(email) || !STAFF_ROLES.has(role)) return null;
  return { type: "invite_staff", payload: { email, name: name || null, role } };
}
