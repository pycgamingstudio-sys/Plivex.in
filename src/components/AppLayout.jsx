import { NavLink, Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import PresenceBeacon from "@/components/PresenceBeacon";
import Logo from "@/components/Logo";
import { navItems, MORE_NAV_ITEMS, HIDDEN_FROM_SIDEBAR } from "@/lib/nav";
import { useRole } from "@/lib/roles";
import { usePaywall } from "@/lib/paywall";
import { useAuth } from "@/lib/AuthContext";
import { APP_EDITION } from "@/api/backendClient";
import { getCountryByCode, getCountryFlag } from "@/global/countries/country-registry.js";
import { useWorkspaceFeatures } from "@/lib/workspaceFeatures";
import { LayoutDashboard, Users, Package, FileText, Handshake, Warehouse, Calculator, ShoppingCart, MoreHorizontal, ChevronDown, Moon, Sun } from "lucide-react";

const GLOBAL_NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/quotations", label: "Quotations", icon: FileText },
  { to: "/expenses", label: "Purchase", icon: ShoppingCart },
  { to: "/accounting", label: "Reports", icon: Calculator },
  { to: "/crm", label: "Client CRM", icon: Handshake },
  { to: "/products", label: "Stock", icon: Package },
  { to: "/enterprise", label: "Team", icon: Users },
  { to: "/inventory-procurement", label: "Warehouse", icon: Warehouse },
];

const navPillClass = (isActive) =>
  `flex min-h-10 shrink-0 snap-start items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${isActive ? "bg-primary text-primary-foreground shadow-sm" : "border border-[#E8E7EF] bg-white text-muted-foreground hover:border-violet-200 hover:bg-violet-50/60 hover:text-foreground"}`;

export default function AppLayout({ children }) {
  const { role } = useRole();
  const { user, logout } = useAuth();
  const { features: workspaceFeatures } = useWorkspaceFeatures(user?.workspace_id);
  const { canAccess, openPaywall } = usePaywall();
  const isGlobal = APP_EDITION === "global";
  const [moreOpen, setMoreOpen] = useState(false);
  const [isDark, setIsDark] = useState(() => {
    if (APP_EDITION === "global") return false;
    try { return localStorage.getItem("plivex-main-workspace-theme") === "dark"; } catch { return false; }
  });
  useEffect(() => {
    if (isGlobal) return;
    document.documentElement.dataset.plivexTheme = isDark ? "dark" : "light";
    try { localStorage.setItem("plivex-main-workspace-theme", isDark ? "dark" : "light"); } catch { /* preference storage is optional */ }
  }, [isGlobal, isDark]);

  const isFeatureAvailable = (path) => {
    if (path === "/crm" || path === "/client-database") return workspaceFeatures.includes("crm") || workspaceFeatures.includes("leads");
    if (path === "/inventory-procurement") return workspaceFeatures.includes("inventoryWorkspace");
    if (path === "/usage-reports" || path === "/tax-summary" || path === "/account-activity") return workspaceFeatures.includes("reports");
    if (path === "/payment-logs") return workspaceFeatures.includes("expenses");
    if (path === "/templates" || path === "/service-catalog") return workspaceFeatures.includes("quotations");
    return true;
  };

  const items = navItems.filter((item) =>
    item.to !== "/" &&
    !HIDDEN_FROM_SIDEBAR.includes(item.to) &&
    (!item.roles || item.roles.includes(role)) &&
    isFeatureAvailable(item.to)
  );

  const moreItems = MORE_NAV_ITEMS.filter((item) =>
    (!item.roles || item.roles.includes(role)) && isFeatureAvailable(item.to)
  );

  const globalItems = GLOBAL_NAV.filter((item) => {
    if (item.to === "/inventory-procurement") return workspaceFeatures.includes("inventoryWorkspace");
    if (item.to === "/expenses") return workspaceFeatures.includes("expenses");
    if (item.to === "/crm") return workspaceFeatures.includes("crm") || workspaceFeatures.includes("leads");
    if (item.to === "/accounting") return workspaceFeatures.includes("reports");
    return true;
  });

  return (
    <div className={`plivex-main-layout min-h-screen bg-background ${!isGlobal && isDark ? "dark" : ""}`}>
      <header className="sticky top-0 z-20 border-b border-[#E8E7EF] bg-white/95 shadow-[0_1px_2px_rgba(24,24,40,.025)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <NavLink to="/" className="flex shrink-0 items-center gap-2">
              <Logo className="h-8 w-8" />
              <p className="text-[15px] font-bold tracking-[-0.04em]">Pli<span className="text-primary">vex</span></p>
            </NavLink>
            <div className="hidden min-w-0 items-center gap-2 sm:flex">
              <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-1 text-[10px] font-semibold text-violet-800">Workspace</span>
              <span className="max-w-[22rem] truncate text-[11px] text-muted-foreground">
                {[user?.workspace_name, getCountryByCode(user?.country_code)?.name || user?.country_code, user?.currency_code].filter(Boolean).join(" · ") || "Set up your workspace"}
              </span>
            </div>
          </div>
          {isGlobal ? (
            <div className="flex shrink-0 items-center gap-2">
              <span className="hidden max-w-36 truncate text-[11px] text-muted-foreground sm:inline">{user?.email}</span>
              <button type="button" onClick={() => logout()} className="rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors hover:bg-secondary">Sign out</button>
            </div>
          ) : (
            <div className="flex shrink-0 items-center gap-2">
              {!isGlobal && <button type="button" onClick={() => setIsDark((value) => !value)} aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"} title={isDark ? "Switch to light theme" : "Switch to dark theme"} className="flex h-9 w-9 items-center justify-center rounded-lg border text-muted-foreground transition-colors hover:bg-secondary">{isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button>}
              <NavLink to="/" className="rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors hover:bg-secondary">← Invoice desk</NavLink>
            </div>
          )}
        </div>
        <div data-testid="compact-workspace-identity" className="mx-auto flex min-w-0 max-w-6xl items-center gap-2 px-4 pb-2 sm:hidden">
          <span aria-hidden="true" className="shrink-0 text-base">{getCountryFlag(user?.country_code) || "🌐"}</span>
          <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-foreground">{user?.workspace_name || "Workspace"}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">{getCountryByCode(user?.country_code)?.name || "Country not set"}{user?.currency_code ? ` · ${user.currency_code}` : ""}</span>
        </div>
        <nav className="mx-auto flex max-w-6xl items-center gap-2 px-4 pb-2.5" aria-label="Workspace">
          <div className="flex min-w-0 flex-1 snap-x snap-mandatory gap-1.5 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {isGlobal ? globalItems.map((item) => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => navPillClass(isActive)}>
                <item.icon className="h-3.5 w-3.5" />{item.label}
              </NavLink>
            )) : items.map((item) => {
              const locked = item.pro && !canAccess("team_management");
              if (locked) {
                return (
                  <button key={item.to} onClick={openPaywall} className="flex min-h-10 shrink-0 snap-start items-center gap-1.5 rounded-full border border-[#E8E7EF] bg-white px-3 py-1.5 text-[12px] font-semibold text-muted-foreground transition-colors hover:text-foreground">
                    <item.icon className="h-3.5 w-3.5" />{item.label}
                    <span className="ml-0.5 rounded-full bg-amber-400 px-1.5 py-0.5 text-[9px] font-bold text-amber-900">PRO</span>
                  </button>
                );
              }
              return (
                <NavLink key={item.to} to={item.to} className={({ isActive }) => navPillClass(isActive)}>
                  <item.icon className="h-3.5 w-3.5" />{item.label}
                </NavLink>
              );
            })}
          </div>
          <div className="relative z-50 shrink-0">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((open) => !open)}
              className="flex min-h-10 items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-[12px] font-bold text-violet-800 shadow-sm transition-colors hover:bg-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              <MoreHorizontal className="h-4 w-4" />More
              <ChevronDown className={`h-3 w-3 transition-transform ${moreOpen ? "rotate-180" : ""}`} />
            </button>
            {moreOpen && (
              <>
                <button type="button" aria-label="Close More menu" className="fixed inset-0 z-40 cursor-default bg-transparent" onClick={() => setMoreOpen(false)} />
                <div role="menu" className="absolute right-0 top-[calc(100%+8px)] z-50 max-h-[min(70vh,28rem)] w-64 overflow-y-auto rounded-2xl border border-[#E8E7EF] bg-white p-2 shadow-[0_14px_40px_rgba(25,18,48,.16)]">
                  <p className="px-3 pb-2 pt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Workspace & account</p>
                  {moreItems.map((item) => (
                    <NavLink key={item.to} to={item.to} role="menuitem" onClick={() => setMoreOpen(false)} className={({ isActive }) => `flex min-h-10 items-center gap-2.5 rounded-xl px-3 py-2 text-[12px] font-semibold transition-colors ${isActive ? "bg-violet-50 text-violet-800" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}>
                      <item.icon className="h-4 w-4 shrink-0" />{item.label}
                    </NavLink>
                  ))}
                  {moreItems.length === 0 && <p className="px-3 py-3 text-xs text-slate-500">No additional sections are available for this role.</p>}
                </div>
              </>
            )}
          </div>
        </nav>
      </header>
      <main className={`mx-auto max-w-6xl px-4 py-6 ${isGlobal ? "min-h-[calc(100vh-120px)] bg-[#F8F7FC]" : ""}`}>{children ?? <Outlet />}</main>
      {!isGlobal && <PresenceBeacon />}
    </div>
  );
}