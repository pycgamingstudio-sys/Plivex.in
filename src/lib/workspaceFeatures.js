import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/api/backendClient";

export const PERMANENT_DASHBOARD_FEATURES = Object.freeze(["invoices", "stock", "team"]);
export const WORKSPACE_FEATURE_CATALOG = Object.freeze([
  { id: "quotations", label: "Quotations", description: "Prepare estimates and convert approved quotes into invoices." },
  { id: "expenses", label: "Expenses", description: "Record business expenses and purchase costs." },
  { id: "crm", label: "Client CRM", description: "Keep client details and communication organized." },
  { id: "leads", label: "Lead Tracker", description: "Track prospects and follow-ups." },
  { id: "inventoryWorkspace", label: "Warehouse & Operations", description: "Manage locations, transfers, purchase orders and goods receipts." },
  { id: "reports", label: "Reports", description: "Review business performance and operational reports." },
]);

export function normalizeWorkspaceFeatures(value) {
  if (!Array.isArray(value)) return null;
  const allowed = new Set(WORKSPACE_FEATURE_CATALOG.map((item) => item.id));
  return [...new Set(value.filter((id) => typeof id === "string" && allowed.has(id)))];
}

export function getSuggestedWorkspaceFeatures(workTypes = []) {
  const selected = new Set();
  if (workTypes.includes("freelancer")) {
    ["quotations", "expenses", "crm", "leads", "reports"].forEach((id) => selected.add(id));
  }
  if (workTypes.includes("business")) {
    ["quotations", "expenses", "crm", "leads", "inventoryWorkspace", "reports"].forEach((id) => selected.add(id));
  }
  return [...selected];
}

/** Per-user preferences are stored in Supabase Auth metadata, not shared browser state. */
export function useWorkspaceFeatures(userId) {
  const [features, setFeatures] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    if (!userId) { setFeatures(null); return () => { active = false; }; }
    supabase.auth.getUser().then(({ data, error: readError }) => {
      if (!active) return;
      if (readError) { setError("Your feature preferences could not be loaded."); setFeatures(WORKSPACE_FEATURE_CATALOG.map((item) => item.id)); return; }
      const stored = normalizeWorkspaceFeatures(data?.user?.user_metadata?.plivex_workspace_features);
      // Existing workspaces keep their current tools until they choose to personalize.
      setFeatures(stored ?? WORKSPACE_FEATURE_CATALOG.map((item) => item.id));
    }).catch(() => {
      if (active) setFeatures(WORKSPACE_FEATURE_CATALOG.map((item) => item.id));
    });
    return () => { active = false; };
  }, [userId]);

  const updateFeatures = useCallback(async (nextValue) => {
    const next = normalizeWorkspaceFeatures(nextValue);
    if (!next) return false;
    setSaving(true); setError("");
    try {
      const { data, error: readError } = await supabase.auth.getUser();
      if (readError || !data?.user) throw readError || new Error("Sign in again to update your workspace preferences.");
      const metadata = data.user.user_metadata || {};
      const { error: updateError } = await supabase.auth.updateUser({
        data: { ...metadata, plivex_workspace_features: next },
      });
      if (updateError) throw updateError;
      setFeatures(next);
      return true;
    } catch (saveError) {
      setError(saveError?.message || "Your feature preferences could not be saved.");
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  return {
    features: features ?? WORKSPACE_FEATURE_CATALOG.map((item) => item.id),
    ready: features !== null,
    saving,
    error,
    updateFeatures,
  };
}
