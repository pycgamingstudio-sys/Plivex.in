import {
  Users,
  BarChart3,
  Settings as SettingsIcon,
  LayoutTemplate,
  CreditCard,
  Receipt,
  LifeBuoy,
  Activity,
  Package,
  FilePenLine,
  Link2,
  Warehouse,
  Handshake,
  History,
  Store,
  ShieldCheck,
} from "lucide-react";

const ALL = ["admin", "employee", "accountant"];

export const navItems = [
  { to: "/", label: "Invoice desk", icon: FilePenLine, roles: ALL },
  { to: "/client-database", label: "Client database", icon: Users, roles: ["admin", "employee"] },
  { to: "/crm", label: "CRM & leads", icon: Handshake, roles: ["admin", "manager", "employee"] },
  { to: "/inventory-procurement", label: "Inventory & procurement", icon: Warehouse, roles: ["admin", "manager", "storekeeper"] },
  { to: "/usage-reports", label: "Usage reports", icon: BarChart3, roles: ["admin", "accountant"] },
  { to: "/templates", label: "Quick templates", icon: LayoutTemplate, roles: ["admin", "employee"] },
  { to: "/service-catalog", label: "Service catalog", icon: Package, roles: ["admin", "employee"] },
  { to: "/payment-logs", label: "Payment logs", icon: CreditCard, roles: ["admin", "accountant"] },
  { to: "/tax-summary", label: "Tax summary", icon: Receipt, roles: ["admin", "accountant"] },
];

export const MORE_NAV_ITEMS = [
  // Keep the existing secondary workspace shortcuts in More.
  { to: "/client-database", label: "Client database", icon: Users, roles: ["admin", "employee"] },
  { to: "/usage-reports", label: "Usage reports", icon: BarChart3, roles: ["admin", "accountant"] },
  { to: "/service-catalog", label: "Service catalog", icon: Package, roles: ["admin", "employee"] },
  { to: "/payment-logs", label: "Payment logs", icon: CreditCard, roles: ["admin", "accountant"] },
  // These six destinations were moved from primary navigation into More.
  { to: "/invoice-history", label: "Invoice history", icon: History, roles: ALL },
  { to: "/invoice-shares", label: "Shared invoice links", icon: Link2, roles: ["admin"] },
  { to: "/business-profile", label: "Business profile", icon: Store, roles: ["admin"] },
  { to: "/account-activity", label: "Account activity", icon: Activity, roles: ["admin", "accountant"] },
  { to: "/settings", label: "Settings", icon: SettingsIcon, roles: ["admin"] },
  { to: "/help-center", label: "Help center", icon: LifeBuoy, roles: ALL },
  { to: "/platform", label: "Business tools center", icon: ShieldCheck, roles: ["admin", "manager"] },
];

export const HIDDEN_FROM_SIDEBAR = [
  "/payment-logs",
  "/tax-summary",
  "/service-catalog",
  "/client-database",
  "/usage-reports",
];