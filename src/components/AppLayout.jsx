import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import PresenceBeacon from "@/components/PresenceBeacon";
import Logo from "@/components/Logo";
import { navItems, HIDDEN_FROM_SIDEBAR } from "@/lib/nav";
import { useRole } from "@/lib/roles";
import { usePaywall } from "@/lib/paywall";
import { useAuth } from "@/lib/AuthContext";
import { APP_EDITION } from "@/api/backendClient";
import { getCountryByCode, getCountryFlag } from "@/global/countries/country-registry.js";
import { useWorkspaceFeatures } from "@/lib/workspaceFeatures";
import { LayoutDashboard, Users, Package, Receipt, FileText, Handshake, Calculator, ShoppingCart, Boxes, Sparkles, Zap, LogOut } from "lucide-react";

const GLOBAL_PRIMARY_NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/invoice-history", label: "Sales", icon: Receipt },
  { to: "/expenses", label: "Purchase", icon: ShoppingCart, feature: "expenses" },
  { to: "/accounting", label: "Reports", icon: Calculator, feature: "reports" },
  { to: "/crm", label: "Client CRM", icon: Handshake, feature: "crm" },
  { to: "/products", label: "Stock", icon: Package },
  { to: "/enterprise", label: "Team", icon: Users },
  { to: "/inventory-procurement", label: "Warehouse", icon: Boxes, feature: "inventoryWorkspace" },
];

const GLOBAL_WORKSPACE_NAV = [
  { to: "/quotations", label: "Quotations", icon: FileText },
  { to: "/client-database", label: "Clients", icon: Users, feature: "crm" },
];

function GlobalWorkspaceShell({ children }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { features } = useWorkspaceFeatures(user?.id);
  const { planName, isPremium, openPaywall } = usePaywall();
  const country = getCountryByCode(user?.country_code);
  const flag = getCountryFlag(user?.country_code);
  const primary = GLOBAL_PRIMARY_NAV.filter((item) => !item.feature || features.includes(item.feature) || (item.feature === "crm" && features.includes("leads")));
  const secondary = GLOBAL_WORKSPACE_NAV.filter((item) => !item.feature || features.includes(item.feature) || (item.feature === "crm" && features.includes("leads")));
  const active = [...GLOBAL_PRIMARY_NAV, ...GLOBAL_WORKSPACE_NAV].find((item) => item.to === pathname) || GLOBAL_PRIMARY_NAV[0];
  const createInvoice = () => navigate("/invoice-builder", { state: { newInvoice: true } });

  return (
    <div className="plivex-dashboard min-h-screen bg-slate-50 text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col overflow-y-auto border-r border-[#E5E7EB] bg-white md:flex">
        <div className="flex items-center gap-2.5 px-5 py-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#6D28D9] text-[14px] font-bold text-white">P</div>
          <div><p className="text-[16px] font-bold tracking-[-0.03em]">Plivex</p><p className="text-[10px] text-slate-400">Enterprise billing</p></div>
        </div>
        <div className="mx-3 mb-3 flex items-center gap-2 rounded-xl border border-violet-100 bg-violet-50 px-3 py-2">
          <span className="text-lg" aria-hidden="true">{flag || "🌐"}</span>
          <div className="min-w-0"><p className="truncate text-[11px] font-bold text-violet-900">{country?.name || "Global workspace"}</p><p className="text-[10px] text-violet-700">{user?.currency_code || country?.currencyCode || ""}</p></div>
        </div>
        <div className="px-3">
          <button onClick={createInvoice} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#6D28D9] px-3 py-2.5 text-[12px] font-bold text-white transition-colors hover:bg-[#7C3AED]">+ New Invoice</button>
        </div>
        <nav aria-label="Primary workspace navigation" className="mt-5 space-y-1 px-3">
          {primary.map((item) => <NavLink key={item.to} to={item.to} className={({ isActive }) => `flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-[13px] font-semibold transition-colors ${isActive ? "bg-[#6D28D9] text-white" : "text-slate-600 hover:bg-slate-100"}`}><item.icon className="h-4 w-4" />{item.label}</NavLink>)}
        </nav>
        <div className="mt-4 px-3">
          <p className="px-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Workspace</p>
          <div className="mt-2 space-y-0.5">
            {secondary.map((item) => <NavLink key={item.to} to={item.to} className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-[12px] font-medium transition-colors ${isActive ? "bg-violet-50 text-[#6D28D9]" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"}`}><item.icon className="h-3.5 w-3.5" />{item.label}</NavLink>)}
          </div>
        </div>
        <div className="mt-auto border-t border-[#E5E7EB] p-3">
          {isPremium ? <div className="mb-3 flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-[12px] font-bold text-emerald-700"><Sparkles className="h-4 w-4" />{planName || "Premium"} plan active</div> : <button onClick={() => openPaywall()} className="mb-3 flex w-full items-center justify-between rounded-xl bg-gradient-to-br from-[#6D28D9] to-[#7C3AED] px-3 py-2.5 text-[12px] font-bold text-white"><span className="flex items-center gap-2"><Zap className="h-4 w-4" />Get Premium</span></button>}
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#6D28D9] text-[11px] font-bold text-white">{(user?.full_name || user?.email || "U").charAt(0).toUpperCase()}</div>
            <div className="min-w-0 flex-1"><p className="truncate text-[12px] font-bold text-slate-900">{user?.full_name || "Account"}</p><p className="truncate text-[10px] text-slate-400">{user?.email || ""}</p></div>
            <button type="button" onClick={() => logout()} aria-label="Sign out" title="Sign out" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><LogOut className="h-4 w-4" /></button>
          </div>
          <a href="mailto:support@plivex.in" className="mt-3 block truncate border-t border-[#E5E7EB] pt-3 text-[10px] font-semibold text-slate-500 hover:text-[#6D28D9]">support@plivex.in</a>
        </div>
      </aside>
      <div className="md:pl-64">
        <header className="sticky top-0 z-20 border-b border-[#E5E7EB] bg-white/90 backdrop-blur-xl">
          <div className="flex min-w-0 items-center justify-between gap-2 px-3 py-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-2"><active.icon className="h-5 w-5 shrink-0 text-[#6D28D9]" /><h1 className="truncate text-[15px] font-bold tracking-[-0.03em] sm:text-[17px]">{active.label}</h1></div>
            <div className="flex shrink-0 items-center gap-2">
              <span data-testid="active-workspace-edition" className="hidden rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-800 sm:inline-flex">{flag} {country?.name || user?.country_code} · {user?.currency_code}</span>
              <span className="hidden rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 sm:inline">● {planName || "Free"}</span>
              <button type="button" onClick={() => logout()} className="rounded-lg border border-[#E5E7EB] px-3 py-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"><span className="sm:hidden"><LogOut className="h-4 w-4" /></span><span className="hidden sm:inline">Sign out</span></button>
            </div>
          </div>
        </header>
        <main className="plivex-dashboard-main min-h-[calc(100vh-58px)] p-4 pb-24 sm:p-6 md:pb-6">{children ?? <Outlet />}</main>
      </div>
      <nav aria-label="Primary workspace navigation" className="fixed inset-x-0 bottom-0 z-30 flex overflow-x-auto overscroll-x-contain border-t border-[#E5E7EB] bg-white md:hidden">
        {primary.map((item) => <NavLink key={item.to} to={item.to} className={({ isActive }) => `flex min-w-[72px] shrink-0 flex-col items-center gap-1 px-2.5 py-2.5 text-[10px] font-semibold transition-colors ${isActive ? "text-[#6D28D9]" : "text-slate-400"}`}><item.icon className="h-5 w-5" />{item.label}</NavLink>)}
      </nav>
    </div>
  );
}

export default function AppLayout({ children }) {
  const { role } = useRole();
  const { user, logout } = useAuth();
  const { features: workspaceFeatures } = useWorkspaceFeatures(user?.id);
  const { canAccess, openPaywall } = usePaywall();
  const isGlobal = APP_EDITION === "global";
  if (isGlobal) return <GlobalWorkspaceShell>{children ?? <Outlet />}</GlobalWorkspaceShell>;
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
            if (item.to === "/products") return true;
            if (item.to === "/quotations") return true;
            if (item.to === "/inventory-procurement") return workspaceFeatures.includes("inventoryWorkspace");
            if (item.to === "/expenses") return workspaceFeatures.includes("expenses");
            if (item.to === "/crm") return workspaceFeatures.includes("crm") || workspaceFeatures.includes("leads");
            if (item.to === "/accounting") return workspaceFeatures.includes("reports");
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