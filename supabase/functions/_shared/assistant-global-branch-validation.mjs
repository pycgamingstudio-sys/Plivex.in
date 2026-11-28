const clean = (value, max) => String(value ?? "").trim().slice(0, max);
const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{0,31}$/;

export function validateGlobalBranchAction(action) {
  if (!action || typeof action !== "object" || action.type !== "create_global_branch") return null;
  const raw = action.payload && typeof action.payload === "object" ? action.payload : {};
  const rawName = String(raw.name ?? "").trim();
  const rawCode = String(raw.branch_code ?? "").trim();
  const name = clean(rawName, 160);
  const branchCode = clean(rawCode, 32).toUpperCase();
  const sourceAddress = raw.address && typeof raw.address === "object" && !Array.isArray(raw.address) ? raw.address : {};
  if (!name || rawName.length > 160 || rawCode.length > 32 || !CODE_RE.test(branchCode)) return null;
  const rawCountryCode = String(sourceAddress.country_code ?? "").trim();
  if (rawCountryCode.length > 2) return null;
  const address = {
    line1: clean(sourceAddress.line1, 180),
    line2: clean(sourceAddress.line2, 180),
    city: clean(sourceAddress.city, 100),
    state: clean(sourceAddress.state, 100),
    postal_code: clean(sourceAddress.postal_code, 24),
    country_code: clean(sourceAddress.country_code, 2).toUpperCase(),
  };
  if (address.country_code && !/^[A-Z]{2}$/.test(address.country_code)) return null;
  return {
    type: "create_global_branch",
    payload: { name, branch_code: branchCode, address },
  };
}

export function validateGlobalBranchAgainstContext(action, context) {
  if (!action || action.type !== "create_global_branch" || !context || context.context_unavailable
    || !Array.isArray(context.branches)) return { ok: false, reason: "context_unavailable" };
  const code = action.payload.branch_code.toUpperCase();
  const name = action.payload.name.trim().toLowerCase();
  if (context.branches.some((branch) => String(branch?.branch_code || "").toUpperCase() === code)) {
    return { ok: false, reason: "duplicate_code" };
  }
  if (context.branches.some((branch) => String(branch?.name || "").trim().toLowerCase() === name)) {
    return { ok: false, reason: "duplicate_name" };
  }
  return { ok: true, summary: "Create Main Workspace branch " + action.payload.name + " (" + code + "). The owner/admin permission and unique branch code will be checked again at confirmation." };
}
