
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

// Staff presence tracking is switched off until its backend is built.
// The functions stay so existing screens keep working.
export async function pingPresence() { /* no-op for now */ }
export async function trackStaffAction() { /* no-op for now */ }
