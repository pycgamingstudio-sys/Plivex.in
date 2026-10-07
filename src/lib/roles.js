import { useAuth } from "@/lib/AuthContext";

export const ROLES = {
  admin: { label: "Owner / Boss", description: "Full access to everything—settings, billing, profit & loss, stock and staff management." },
  manager: { label: "Manager", description: "View and manage invoices, quotations, CRM, expenses and stock. Restricted from admin settings and subscription billing." },
  employee: { label: "Billing Executive / Sales", description: "Create, view and send invoices and quotations, and view the client CRM. Financials, settings and team management are hidden." },
  storekeeper: { label: "Store Keeper / Inventory", description: "Restricted to the Stock / Inventory tab to update stock quantities and watch low-stock alerts." },
  accountant: { label: "Accountant / CA", description: "Read-only access to financial reports, tax summaries, P&L and expense logs. Cannot create invoices or change settings." },
};

export const ROLE_ORDER = ["admin", "manager", "employee", "storekeeper", "accountant"];

const ROUTE_PERMISSIONS = {
  admin: ["*"],
  manager: ["/", "/invoice-builder", "/invoice-history", "/client-database", "/service-catalog", "/templates", "/help-center"],
  employee: ["/", "/invoice-builder", "/invoice-history", "/client-database", "/templates", "/help-center"],
  storekeeper: ["/", "/help-center"],
  accountant: ["/", "/invoice-history", "/usage-reports", "/tax-summary", "/payment-logs", "/account-activity", "/help-center"],
};

export const TAB_PERMISSIONS = {
  admin: ["dashboard", "sales", "purchase", "reports", "crm", "stock", "team"],
  manager: ["dashboard", "sales", "purchase", "crm", "stock"],
  employee: ["dashboard", "sales", "crm"],
  storekeeper: ["dashboard", "stock"],
  accountant: ["dashboard", "sales", "purchase", "reports"],
};

export function normalizeRole(role) {
  if (ROLE_ORDER.includes(role)) return role;
  // legacy 'user' and unknown roles are treated as restricted (employee)
  return "employee";
}

export function canAccessRoute(role, path) {
  const r = normalizeRole(role);
  const allowed = ROUTE_PERMISSIONS[r] || [];
  if (allowed.includes("*")) return true;
  return allowed.includes(path);
}

export function canAccessTab(role, tabId) {
  const r = normalizeRole(role);
  return (TAB_PERMISSIONS[r] || []).includes(tabId);
}

export function getRoleLabel(role) {
  return ROLES[normalizeRole(role)]?.label || role;
}

export function useRole() {
  const { user } = useAuth();
  const role = normalizeRole(user?.role || "admin");
  return {
    role,
    isAdmin: role === "admin",
    isManager: role === "manager",
    isEmployee: role === "employee",
    isStorekeeper: role === "storekeeper",
    isAccountant: role === "accountant",
    canAccessRoute: (path) => canAccessRoute(role, path),
    canAccessTab: (tab) => canAccessTab(role, tab),
  };
}