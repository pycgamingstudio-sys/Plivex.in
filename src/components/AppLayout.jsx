import { NavLink, Outlet } from "react-router-dom";
import PresenceBeacon from "@/components/PresenceBeacon";
import Logo from "@/components/Logo";
import { navItems, HIDDEN_FROM_SIDEBAR } from "@/lib/nav";
import { useRole } from "@/lib/roles";
import { usePaywall } from "@/lib/paywall";
import { useAuth } from "@/lib/AuthContext";
import { APP_EDITION } from "@/api/backendClient";
import { getCountryByCode } from "@/global/countries/country-registry.js";
import { useWorkspaceFeatures } from "@/lib/workspaceFeatures";
import { LayoutDashboard, Users, Package, Receipt, FileText, Handshake, Warehouse, Calculator, ShieldCheck } from "lucide-react";

const GLOBAL_NAV = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { to: "/client-database", label: "Clients", icon: Users },
  { to: "/products", label: "Products", icon: Package },
  { to: "/expenses", label: "Expenses", icon: Receipt },
  { to: "/crm", label: "CRM & Leads", icon: Handshake },
  { to: "/inventory-procurement", label: "Inventory & Warehouse", icon: Warehouse },
  { to: "/invoice-history", label: "Invoices", icon: FileText },
  { to: "/accounting", label: "Accounting", icon: Calculator },
  { to: "/enterprise", label: "Enterprise", icon: ShieldCheck },
];

export default function AppLayout({ children }) {
  const { role } = useRole();
  const { user, logout } = useAuth();
  const { features: workspaceFeatures } = useWorkspaceFeatures(user?.id);
  const { canAccess, openPaywall } = usePaywall();
  const isGlobal = APP_EDITION === "global";
  const items = navItems.filter((i) => {
    if (i.to === "/" || HIDDEN_FROM_SIDEBAR.includes(i.to) || (i.roles && !i.roles.includes(role))) return false;
    if (i.to === "/crm" || i.to === "/client-database") return workspaceFeatures.includes("crm") || workspaceFeatures.includes("leads");
    if (i.to === "/inventory-procurement") return workspaceFeatures.includes("inventoryWorkspace");
    if (i.to === "/usage-reports" || i.to === "/tax-summary" || i.to === "/account-activity") return workspaceFeatures.includes("reports");
    if (i.to === "/payment-logs") return workspaceFeatures.includes("expenses");
    if (i.to === "/templates") return workspaceFeatures.includes("quotations");
    return true;
  });
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <NavLink to="/" className="flex shrink-0 items-center gap-2">
              <Logo className="h-8 w-8" />
              <p className="text-[15px] font-bold tracking-[-0.04em]">Pli<span className="text-primary">vex</span></p>
            </NavLink>
            {isGlobal ? (
              <div className="hidden min-w-0 items-center gap-2 sm:flex">
                <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-1 text-[10px] font-semibold text-violet-800">Global Workspace</span>
                <span className="truncate text-[11px] text-muted-foreground">{user?.workspace_name} · {getCountryByCode(user?.country_code)?.name || user?.country_code} · {user?.currency_code}</span>
              </div>
            ) : (
              <span className="hidden rounded-full border border-violet-200 bg-violet-50 px-2 py-1 text-[10px] font-semibold text-violet-800 sm:inline-flex">India Workspace · {getCountryByCode(user?.country_code)?.name || "India"}</span>
            )}
          </div>
          {isGlobal ? (
            <div className="flex shrink-0 items-center gap-2">
              <span className="hidden max-w-36 truncate text-[11px] text-muted-foreground sm:inline">{user?.email}</span>
              <button type="button" onClick={() => logout()} className="rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors hover:bg-secondary">Sign out</button>
            </div>
          ) : (
            <NavLink to="/" className="rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors hover:bg-secondary">← Invoice desk</NavLink>
          )}
        </div>
        <nav className="mx-auto flex max-w-6xl snap-x snap-mandatory gap-1.5 overflow-x-auto overscroll-x-contain px-4 pb-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Workspace">
          {isGlobal ? GLOBAL_NAV.filter((item) => {
            if (item.to === "/client-database") return workspaceFeatures.includes("crm");
            if (item.to === "/products") return true;
            if (item.to === "/inventory-procurement") return workspaceFeatures.includes("inventoryWorkspace");
            if (item.to === "/expenses") return workspaceFeatures.includes("expenses");
            if (item.to === "/crm") return workspaceFeatures.includes("crm") || workspaceFeatures.includes("leads");
            if (item.to === "/accounting") return workspaceFeatures.includes("reports");
            if (item.to === "/enterprise") return workspaceFeatures.includes("enterprise");
            return true;
          }).map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `flex min-h-10 shrink-0 snap-start items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors ${isActive ? "bg-primary text-primary-foreground" : "border bg-card text-muted-foreground hover:text-foreground"}`}>
              <item.icon className="h-3.5 w-3.5" />{item.label}
            </NavLink>
          )) : items.map((item) => {
            const locked = item.pro && !canAccess("team_management");
            if (locked) {
              return (
                <button key={item.to} onClick={openPaywall} className="flex min-h-10 shrink-0 snap-start items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-[12px] font-semibold text-muted-foreground transition-colors hover:text-foreground">
                  <item.icon className="h-3.5 w-3.5" />{item.label}
                  <span className="ml-0.5 rounded-full bg-amber-400 px-1.5 py-0.5 text-[9px] font-bold text-amber-900">PRO</span>
                </button>
              );
            }
            return (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => `flex min-h-10 shrink-0 snap-start items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors ${isActive ? "bg-primary text-primary-foreground" : "border bg-card text-muted-foreground hover:text-foreground"}`}>
                <item.icon className="h-3.5 w-3.5" />{item.label}
              </NavLink>
            );
          })}
        </nav>
      </header>
      <main className={`mx-auto max-w-6xl px-4 py-6 ${isGlobal ? "min-h-[calc(100vh-120px)] bg-[#F8F7FC]" : ""}`}>{children ?? <Outlet />}</main>
      {!isGlobal && <PresenceBeacon />}
    </div>
  );
}