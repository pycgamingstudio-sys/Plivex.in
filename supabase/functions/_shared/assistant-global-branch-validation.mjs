const clean = (value, max) => String(value ?? "").trim().slice(0, max);
const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{0,31}$/;

export function validateGlobalBranchAction(action) {
  if (!action || typeof action !== "object" || action.type !== "create_global_branch") return null;
  const raw = action.payload && typeof action.payload === "object" ? action.payload : {};
  const name = clean(raw.name, 160);
  const branchCode = clean(raw.branch_code, 32).toUpperCase();
  const sourceAddress = raw.address && typeof raw.address === "object" && !Array.isArray(raw.address) ? raw.address : {};
  if (!name || !CODE_RE.test(branchCode)) return null;
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
