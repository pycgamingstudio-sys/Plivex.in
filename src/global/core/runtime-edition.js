/**
 * Classify an authenticated identity without conflating legacy India records
 * with Global workspaces. Explicit runtime choice wins; an existing Global
 * membership is checked before falling back to a legacy India profile.
 */
export function resolveRuntimeEdition({
  buildEdition,
  mode,
  hasLegacyProfile = false,
  hasGlobalWorkspace = false,
  countryCode = "",
  firstGoogleSignup = false,
}) {
  if (buildEdition === "global") return "global";
  if (buildEdition !== "unified") return "india";
  if (mode === "global") return "global";
  if (mode === "india") return "india";
  if (mode === "pending") return "pending";
  if (firstGoogleSignup) return "pending";
  if (hasGlobalWorkspace) return "global";
  if (hasLegacyProfile) return "india";
  const country = typeof countryCode === "string" ? countryCode.trim().toUpperCase() : "";
  if (country && country !== "IN") return "global";
  return "pending";
}
