import { useCallback, useEffect, useState } from "react";
import { supabase, APP_EDITION } from "@/api/backendClient";

export const PERMANENT_DASHBOARD_FEATURES = Object.freeze(["invoices", "quotations"]);
export function getPermanentDashboardFeatures(workspaceType = "business") {
  return workspaceType === "freelancer"
    ? [...PERMANENT_DASHBOARD_FEATURES]
    : [...PERMANENT_DASHBOARD_FEATURES, "stock", "team"];
}
export const WORKSPACE_FEATURE_CATALOG = Object.freeze([
  { id: "expenses", label: "Expenses", description: "Record business expenses and purchase costs." },
  { id: "crm", label: "Client CRM", description: "Keep client details and communication organized." },
  { id: "leads", label: "Lead Tracker", description: "Track prospects and follow-ups." },
  { id: "inventoryWorkspace", label: "Warehouse & Operations", description: "Manage locations, transfers, purchase orders and goods receipts." },
  { id: "reports", label: "Reports", description: "Review business performance and operational reports." },
]);

export function getAvailableWorkspaceFeatureCatalog() {
  return WORKSPACE_FEATURE_CATALOG;
}

export function normalizeWorkspaceFeatures(value, edition = APP_EDITION) {
  if (!Array.isArray(value)) return null;
  const allowed = new Set(getAvailableWorkspaceFeatureCatalog(edition).map((item) => item.id));
  return [...new Set(value.filter((id) => typeof id === "string" && allowed.has(id)))];
}

export function getSuggestedWorkspaceFeatures(workTypes = []) {
  const selected = new Set();
  if (workTypes.includes("freelancer")) {
    ["expenses", "crm", "leads", "reports"].forEach((id) => selected.add(id));
  }
  if (workTypes.includes("business")) {
    ["expenses", "crm", "leads", "inventoryWorkspace", "reports"].forEach((id) => selected.add(id));
  }
  return [...selected];
}

/** Workspace feature preferences are stored on the canonical workspace.
 * The retired Global build keeps its compatibility metadata path until that worker is decommissioned.
 */
export function useWorkspaceFeatures(workspaceId, workspaceIdentity = {}) {
  const [features, setFeatures] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setFeatures(null);
    setError("");
    if (!workspaceId) { setFeatures(null); return () => { active = false; }; }

    const load = async () => {
      if (APP_EDITION === "global") {
        const { data, error: readError } = await supabase.auth.getUser();
        if (readError) throw readError;
        return normalizeWorkspaceFeatures(data?.user?.user_metadata?.plivex_workspace_features)
          ?? WORKSPACE_FEATURE_CATALOG.map((item) => item.id);
      }
      const { data, error: readError } = await supabase.from("workspace_settings")
        .select("optional_features").eq("workspace_id", workspaceId).maybeSingle();
      if (readError) throw readError;
      return normalizeWorkspaceFeatures(data?.optional_features) ?? [];
    };

    load().then((next) => {
      if (active) setFeatures(next);
    }).catch(() => {
      if (!active) return;
      setError("Your workspace feature preferences could not be loaded.");
      setFeatures([]);
    });
    return () => { active = false; };
  }, [workspaceId]);

  // Keep independently mounted dashboard and navigation consumers in sync.
  useEffect(() => {
    const onPreferencesChanged = (event) => {
      const next = normalizeWorkspaceFeatures(event?.detail?.features);
      if (next) setFeatures(next);
    };
    window.addEventListener("plivex:workspace-features-updated", onPreferencesChanged);
    return () => window.removeEventListener("plivex:workspace-features-updated", onPreferencesChanged);
  }, []);

  const updateFeatures = useCallback(async (nextValue) => {
    const next = normalizeWorkspaceFeatures(nextValue);
    if (!next || !workspaceId) return false;
    setSaving(true); setError("");
    try {
      if (APP_EDITION === "global") {
        const { data, error: readError } = await supabase.auth.getUser();
        if (readError || !data?.user) throw readError || new Error("Sign in again to update workspace preferences.");
        const metadata = data.user.user_metadata || {};
        const { error: updateError } = await supabase.auth.updateUser({
          data: { ...metadata, plivex_workspace_features: next },
        });
        if (updateError) throw updateError;
      } else {
        const table = supabase.from("workspace_settings");
        const { data: existing, error: readError } = await table
          .select("workspace_id")
          .eq("workspace_id", workspaceId)
          .maybeSingle();
        if (readError) throw readError;

        const updatedAt = new Date().toISOString();
        if (existing?.workspace_id) {
          const { data: saved, error: updateError } = await table
            .update({ optional_features: next, updated_at: updatedAt })
            .eq("workspace_id", workspaceId)
            .select("workspace_id")
            .maybeSingle();
          if (updateError) throw updateError;
          if (!saved?.workspace_id) throw new Error("Workspace feature preferences were not saved. Check your workspace permissions and retry.");
        } else {
          const countryCode = String(workspaceIdentity.country_code || "").trim().toUpperCase();
          const localeCode = String(workspaceIdentity.locale_code || "").trim();
          const currencyCode = String(workspaceIdentity.currency_code || "").trim().toUpperCase();
          const workspaceType = String(workspaceIdentity.workspace_type || "").trim();
          if (!countryCode || !localeCode || !currencyCode || !["freelancer", "business"].includes(workspaceType)) {
            throw new Error("Workspace settings are incomplete. Reopen Workspace setup before changing feature preferences.");
          }
          const { data: saved, error: insertError } = await table
            .upsert({
              workspace_id: workspaceId,
              country_code: countryCode,
              locale_code: localeCode,
              currency_code: currencyCode,
              workspace_type: workspaceType,
              optional_features: next,
              updated_at: updatedAt,
            }, { onConflict: "workspace_id" })
            .select("workspace_id")
            .maybeSingle();
          if (insertError) throw insertError;
          if (!saved?.workspace_id) throw new Error("Workspace feature preferences could not be confirmed as saved.");
        }
      }
      setFeatures(next);
      window.dispatchEvent(new CustomEvent("plivex:workspace-features-updated", { detail: { features: next } }));
      return true;
    } catch (saveError) {
      setError(saveError?.message || "Your feature preferences could not be saved.");
      return false;
    } finally {
      setSaving(false);
    }
  }, [workspaceId]);

  return { features: features ?? [], ready: features !== null, saving, error, updateFeatures };
}
