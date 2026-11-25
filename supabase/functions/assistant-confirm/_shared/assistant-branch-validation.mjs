const clean = (value, max) => String(value ?? "").trim().slice(0, max);

export function validateCreateBranchAction(action) {
  if (!action || typeof action !== "object" || clean(action.type, 40) !== "create_branch") return null;
  const raw = action.payload && typeof action.payload === "object" ? action.payload : {};
  const name = clean(raw.name, 120);
  const branchCode = clean(raw.branch_code, 20).toUpperCase();
  const address = raw.address && typeof raw.address === "object" && !Array.isArray(raw.address) ? raw.address : {};
  const entries = Object.entries(address);
  if (name.length < 2 || !/^[A-Z0-9][A-Z0-9_-]{1,19}$/.test(branchCode) || entries.length > 12) return null;
  const safeAddress = {};
  for (const [key, value] of entries) {
    const safeKey = clean(key, 40);
    if (!safeKey || typeof value !== "string" || value.length > 300) return null;
    safeAddress[safeKey] = clean(value, 300);
  }
  return { type: "create_branch", payload: { name, branch_code: branchCode, address: safeAddress } };
}
