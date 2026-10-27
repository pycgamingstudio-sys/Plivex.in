
import { supabase } from "@/api/backendClient";

const PAGE_LABELS = {
  "/": "Workspace Dashboard",
  "/dashboard": "Workspace Dashboard",
  "/invoice-builder": "Creating an invoice",
  "/invoice-history": "Browsing invoice history",
  "/business-profile": "Business profile settings",
  "/client-database": "Viewing Client CRM",
  "/usage-reports": "Usage reports",
  "/settings": "Workspace settings",
  "/templates": "Quotation templates",
  "/payment-logs": "Payment logs",
  "/tax-summary": "Tax summary",
  "/help-center": "Help center",
  "/account-activity": "Account activity",
  "/service-catalog": "Service catalog",
  "/team-management": "Team management",
};

export const describeRoute = (pathname) => PAGE_LABELS[pathname] || `Viewing ${pathname}`;

// Calls the migration-branch Edge Function. It must be deployed before this branch is used.
export async function pingPresence(page) {
  const { data, error } = await supabase.functions.invoke("ping-presence", { body: { page } });
  if (error) throw error;
  return data;
}

export async function trackStaffAction(action = {}) {
  const { data, error } = await supabase.functions.invoke("track-staff-action", { body: action });
  if (error) {
    let message = error.message || "Could not track staff activity.";
    try {
      const response = error.context;
      if (response && typeof response.clone === "function") {
        const body = await response.clone().json();
        if (typeof body?.error === "string") message = body.error;
      }
    } catch { /* retain SDK error */ }
    const wrapped = new Error(message);
    wrapped.status = error.status || 0;
    throw wrapped;
  }
  return data;
}
