
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

// Supabase Edge Function source is being migrated on the H1 branch.
// Keep the old production route untouched until deployment/runtime verification.
export async function pingPresence(page) {
  const { data, error } = await supabase.functions.invoke("ping-presence", { body: { page } });
  if (error) throw error;
  return data;
}
export async function trackStaffAction(action) {
  // The original track-staff-action contract is still needed before safely migrating it.
  return { skipped: true, reason: "Original endpoint contract not yet verified", action };
}
