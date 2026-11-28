import { useState, useEffect } from "react";
import { useNavigate, NavLink } from "react-router-dom";
import { LayoutDashboard, Receipt, ShoppingCart, BarChart3, Users, UsersRound, Package, Boxes, Sparkles, Zap, LayoutGrid, X, RefreshCw, FileText, ScrollText, Lock, Moon, Sun, BookOpen } from "lucide-react";
import DashboardTab from "@/components/dashboard/DashboardTab";
import Logo from "@/components/Logo";
import SalesTab from "@/components/dashboard/SalesTab";
import PurchaseTab from "@/components/dashboard/PurchaseTab";
import ReportsTab from "@/components/dashboard/ReportsTab";
import BooksTab from "@/components/dashboard/BooksTab";
import CrmTab from "@/components/dashboard/CrmTab";
import StockTab from "@/components/dashboard/StockTab";
import IndiaPart4Tab from "@/components/dashboard/IndiaPart4Tab";
import TeamManagement from "@/pages/TeamManagement";
import ChatWidget from "@/components/dashboard/ChatWidget";
import AssistantWidget from "@/components/AssistantWidget";
import ReconciliationTab from "@/components/dashboard/ReconciliationTab";
import WelcomePopup from "@/components/WelcomePopup";
import { seedDashboard } from "@/lib/dashboardData";
import { navItems, MORE_NAV_ITEMS, HIDDEN_FROM_SIDEBAR } from "@/lib/nav";
import { useDialogA11y } from "@/lib/useDialogA11y";
import { usePaywall } from "@/lib/paywall";
import { useAuth } from "@/lib/AuthContext";
import { useRole, canAccessTab } from "@/lib/roles";
import AccountProfileModal from "@/components/AccountProfileModal";
import PresenceBeacon from "@/components/PresenceBeacon";
import { processDueReminders } from "@/lib/reminders";
import { APP_EDITION } from "@/api/backendClient";
import { getCountryByCode, getCountryFlag } from "@/global/countries/country-registry.js";
import { useWorkspaceFeatures } from "@/lib/workspaceFeatures";

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "sales", label: "Sales", icon: Receipt },
  { id: "purchase", label: "Purchase", icon: ShoppingCart },
  { id: "books", label: "Books", icon: BookOpen },
  { id: "ai", label: "AI", icon: Sparkles },
  { id: "reports", label: "Reports", icon: BarChart3 },
  { id: "crm", label: "Client CRM", icon: Users },
  { id: "stock", label: "Stock", icon: Package },
  { id: "team", label: "Team", icon: UsersRound },
  { id: "warehouses", label: "Warehouse", icon: Boxes },
  { id: "reconciliation", label: "Reconcile", icon: RefreshCw },
];

export default function Dashboard({ initialTab, initialSub, initialIntent, openMoreOnMount = false }) {
  const [tab, setTab] = useState(initialTab || "dashboard");
  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);
  useEffect(() => {
    if (openMoreOnMount) setMoreOpen(true);
  }, [openMoreOnMount]);
  const [isDark, setIsDark] = useState(() => { try { return localStorage.getItem("plivex-main-workspace-theme") === "dark"; } catch { return false; } });
  const [intent, setIntent] = useState(initialIntent || null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const moreDialogRef = useDialogA11y(moreOpen, () => setMoreOpen(false));
  useEffect(() => {
    try { localStorage.setItem("plivex-main-workspace-theme", isDark ? "dark" : "light"); } catch { /* preference storage is optional */ }
    document.documentElement.dataset.plivexTheme = isDark ? "dark" : "light";
  }, [isDark]);
  const navigate = useNavigate();
  const { isPremium, openPaywall, planName, plan, planLoading, canAccess } = usePaywall();
  const { user } = useAuth();
  const { features: workspaceFeatures, ready: workspaceFeaturesReady } = useWorkspaceFeatures(user?.workspace_id);
  const { role, isAccountant } = useRole();
  useEffect(() => {
    seedDashboard();
    // Best-effort daily reminder sweep — true server-side cron requires scheduled workflows on a paid plan.
    processDueReminders();
    const sweep = setInterval(processDueReminders, 30 * 60 * 1000);
    return () => clearInterval(sweep);
  }, []);
  const go = (t, i = null) => { setTab(t); setIntent(i); window.scrollTo({ top: 0 }); };
  const createInvoice = () => navigate("/invoice-builder", { state: { newInvoice: true } });
  const consume = () => setIntent(null);
  const visibleTabs = TABS.filter((t) => {
    if (!canAccessTab(role, t.id)) return false;
    if (t.id === "stock") return user?.workspace_type === "business" || workspaceFeatures.includes("stock");
    if (t.id === "team") return user?.workspace_type === "business" || workspaceFeatures.includes("team");
    if (t.id === "warehouses") return workspaceFeatures.includes("inventoryWorkspace");
    if (t.id === "purchase" || t.id === "reconciliation") return workspaceFeatures.includes("expenses");
    if (t.id === "reports") return workspaceFeatures.includes("reports");
    if (t.id === "crm") return workspaceFeatures.includes("crm") || workspaceFeatures.includes("leads");
    return true;
  });
  const active = visibleTabs.find((t) => t.id === tab) || visibleTabs[0] || TABS[0];
  const preferredMobileTabIds = ["dashboard", "sales", "books", "ai", "reports"];
  const mobilePrimaryTabs = [
    ...visibleTabs.filter((item) => preferredMobileTabIds.includes(item.id)).sort((a, b) => preferredMobileTabIds.indexOf(a.id) - preferredMobileTabIds.indexOf(b.id)),
    ...visibleTabs.filter((item) => !preferredMobileTabIds.includes(item.id)),
  ].slice(0, 5);
  const secondaryTabs = visibleTabs.filter((item) => !mobilePrimaryTabs.some((primary) => primary.id === item.id));
  useEffect(() => {
    if (!workspaceFeaturesReady) return;
    if (!visibleTabs.some((item) => item.id === tab)) setTab("dashboard");
  }, [visibleTabs, tab, workspaceFeaturesReady]);
  const hasGstrAccess = APP_EDITION === "global" || ["basic", "pro"].includes(String(plan || "").toLowerCase());
  const featureRouteEnabled = (path) => {
    if (path === "/crm" || path === "/client-database") return workspaceFeatures.includes("crm") || workspaceFeatures.includes("leads");
    if (path === "/inventory-procurement") return workspaceFeatures.includes("inventoryWorkspace");
    if (["/usage-reports", "/tax-summary", "/account-activity"].includes(path)) return workspaceFeatures.includes("reports");
    if (path === "/payment-logs") return workspaceFeatures.includes("expenses");
    if (path === "/team-management") return user?.workspace_type === "business" || workspaceFeatures.includes("team");
    if (path === "/templates" || path === "/service-catalog") return workspaceFeatures.includes("quotations");
    return true;
  };
  // Keep secondary destinations exclusively in More. Tax summary remains a Workspace destination.
  const pages = navItems.filter((i) =>
    i.to !== "/" &&
    !["/crm", "/inventory-procurement"].includes(i.to) &&
    featureRouteEnabled(i.to) &&
    (!HIDDEN_FROM_SIDEBAR.includes(i.to) || i.to === "/tax-summary") &&
    (!i.roles || i.roles.includes(role))
  );
  const morePages = MORE_NAV_ITEMS.filter((i) =>
    featureRouteEnabled(i.to) && (!i.roles || i.roles.includes(role))
  );
  const teamUnlocked = canAccess("team_management");

  return (
    <div className={`plivex-dashboard min-h-screen bg-slate-50 text-slate-900 ${isDark ? "dark" : ""}`} data-theme={isDark ? "dark" : "light"}>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col overflow-y-auto border-r border-[#E5E7EB] bg-white md:flex">
        <div className="flex items-center gap-2.5 px-5 py-6">
          <Logo className="h-9 w-9" />
          <div><p className="text-[16px] font-bold tracking-[-0.03em]">Plivex</p><p className="text-[10px] text-slate-400">Enterprise billing</p></div>
        </div>
        <nav className="mt-2 space-y-1 px-3">
          {visibleTabs.map((t) => (
            <button key={t.id} onClick={() => go(t.id)} className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-[13px] font-semibold transition-colors ${tab === t.id ? "bg-[#6D28D9] text-white" : "text-slate-600 hover:bg-slate-100"}`}><t.icon className="h-4 w-4" />{t.label}</button>
          ))}
        </nav>
        <div className="mt-4 px-3">
          <p className="px-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Workspace</p>
          <div className="mt-2 space-y-0.5 pr-1">
            {pages.map((p) => {
              const locked = p.pro && !teamUnlocked;
              if (locked) {
                return (
                  <button key={p.to} onClick={openPaywall} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[12px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"><p.icon className="h-3.5 w-3.5" />{p.label}<span className="ml-auto rounded-full bg-amber-400 px-1.5 py-0.5 text-[9px] font-bold text-amber-900">PRO</span></button>
                );
              }
              return (
                <NavLink key={p.to} to={p.to} className="flex items-center gap-3 rounded-lg px-3 py-2 text-[12px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"><p.icon className="h-3.5 w-3.5" />{p.label}</NavLink>
              );
            })}
          </div>
          <div className="mt-4 border-t border-[#E5E7EB] pt-3">
            <p className="px-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">More</p>
            <div className="mt-2 space-y-0.5">
              {morePages.map((p) => (
                <NavLink key={p.to} to={p.to} className="flex items-center gap-3 rounded-lg px-3 py-2 text-[12px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900">
                  <p.icon className="h-3.5 w-3.5" />{p.label}
                </NavLink>
              ))}
            </div>
          </div>
          <div className="mt-3 border-t border-[#E5E7EB] pt-2">
            <p className="px-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Legal</p>
            <div className="mt-1.5 space-y-0.5">
              <NavLink to="/privacy-policy" className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[12px] font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"><FileText className="h-3.5 w-3.5" />Privacy Policy</NavLink>
              <NavLink to="/terms-of-service" className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[12px] font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"><ScrollText className="h-3.5 w-3.5" />Terms &amp; Conditions</NavLink>
              <NavLink to="/cancellation-and-refund" className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[12px] font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"><Receipt className="h-3.5 w-3.5" />Refund Policy</NavLink>
            </div>
          </div>
        </div>
        <div className="mt-auto border-t border-[#E5E7EB] p-3">
          <button onClick={() => setAccountOpen(true)} className="mb-3 flex w-full items-center gap-2.5 rounded-xl border border-[#E5E7EB] px-2.5 py-2 text-left hover:bg-slate-50">
            {user?.profilePicture ? <img src={user.profilePicture} alt="avatar" className="h-8 w-8 rounded-full object-cover" /> : <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#6D28D9] text-[12px] font-bold text-white">{(user?.full_name || user?.email || "U").charAt(0).toUpperCase()}</div>}
            <div className="min-w-0 flex-1"><p className="truncate text-[12px] font-bold text-slate-900">{user?.full_name || "Account"}</p><p className="truncate text-[10px] text-slate-400">{user?.email || "View profile"}</p></div>
          </button>
          {isPremium ? (
            <div className="mb-3 flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-[12px] font-bold text-emerald-700"><Sparkles className="h-4 w-4" />{planName} plan active</div>
          ) : (
            <button onClick={openPaywall} className="mb-3 flex w-full items-center justify-between rounded-xl bg-gradient-to-br from-[#6D28D9] to-[#7C3AED] px-3 py-2.5 text-[12px] font-bold text-white transition-opacity hover:opacity-95">
              <span className="flex items-center gap-2"><Zap className="h-4 w-4" />Get Premium</span>
            </button>
          )}
          {!isAccountant && <button onClick={createInvoice} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#6D28D9] py-2.5 text-[12px] font-bold text-white hover:bg-[#7C3AED]">+ New Invoice</button>}
          <div className="mt-4 border-t border-[#E5E7EB] pt-3">
            <a href="mailto:support@plivex.in" className="block truncate text-[10px] font-semibold text-slate-500 hover:text-[#6D28D9]">support@plivex.in</a>
          </div>
        </div>
      </aside>

      <div className="md:pl-64">
        <header className="sticky top-0 z-20 border-b border-[#E5E7EB] bg-white/90 backdrop-blur-xl">
          <div className="flex min-w-0 items-center justify-between gap-2 px-3 py-3 sm:px-6">
            <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2"><active.icon className="h-5 w-5 shrink-0 text-[#6D28D9]" /><h1 className="min-w-0 max-w-full break-words text-[15px] font-bold leading-tight tracking-[-0.03em] sm:text-[17px]">{active.label}</h1></div>
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              <span className="hidden rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 sm:inline">{`● ${planName || "Free"}`}</span>
              <span data-testid="active-workspace-edition" className="hidden rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-800 sm:inline-flex">Workspace · {getCountryByCode(user?.country_code)?.name || "Choose country"}</span>
              {!isAccountant && <button onClick={createInvoice} aria-label="Create new invoice" title="Create new invoice" className="flex h-9 items-center gap-1 rounded-lg bg-[#6D28D9] px-2 sm:px-2.5 text-[11px] font-bold text-white hover:bg-[#7C3AED] md:hidden">+ <span>Invoice</span></button>}
              <button type="button" onClick={() => setIsDark((value) => !value)} aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"} title={isDark ? "Switch to light theme" : "Switch to dark theme"} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#E5E7EB] text-slate-600 hover:bg-slate-50"><span className="sr-only">{isDark ? "Light theme" : "Dark theme"}</span>{isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button>
              <button onClick={() => setAccountOpen(true)} aria-label="Account" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#E5E7EB] p-0.5 hover:bg-slate-50 sm:w-auto sm:gap-2 sm:py-1 sm:pl-1 sm:pr-2.5">
                {user?.profilePicture ? <img src={user.profilePicture} alt="avatar" className="h-7 w-7 rounded-full object-cover" /> : <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#6D28D9] text-[11px] font-bold text-white">{(user?.full_name || user?.email || "U").charAt(0).toUpperCase()}</div>}
                <span className="hidden text-[11px] font-semibold text-slate-700 sm:inline">{user?.full_name?.split(" ")[0] || "Account"}</span>
              </button>
              <button type="button" onClick={() => setMoreOpen(true)} aria-haspopup="dialog" aria-expanded={moreOpen} className="flex h-9 items-center gap-1 rounded-lg border border-[#E5E7EB] px-2 text-[11px] font-bold text-slate-600 hover:bg-slate-50 md:hidden"><LayoutGrid className="h-4 w-4" /><span>More</span></button>
            </div>
          </div>
          <div data-testid="mobile-workspace-identity" className="flex min-w-0 items-center gap-2 border-t border-slate-100 px-3 py-2 sm:px-6 md:hidden">
            <span aria-hidden="true" className="shrink-0 text-base">{getCountryFlag(user?.country_code) || "🌐"}</span>
            <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-700">{user?.workspace_name || "Workspace"}</span>
            <span className="shrink-0 text-[10px] text-slate-500">{getCountryByCode(user?.country_code)?.name || "Country not set"}{user?.currency_code ? ` · ${user.currency_code}` : ""}</span>
          </div>
        </header>
        <main className="plivex-dashboard-main p-4 pb-24 sm:p-6 md:pb-6">
          {tab === "dashboard" && <DashboardTab onNavigate={go} onCreateInvoice={createInvoice} role={role} teamUnlocked={canAccess("team_management")} />}
          {tab === "sales" && <SalesTab intent={intent} initialSub={initialSub} onConsumeIntent={consume} />}
          {tab === "purchase" && <PurchaseTab intent={intent} onConsumeIntent={consume} />}
          {tab === "books" && <BooksTab />}
          {tab === "ai" && <section className="mx-auto max-w-3xl rounded-2xl border border-violet-100 bg-white p-6 shadow-sm"><div className="flex items-center gap-2 text-lg font-bold text-slate-900"><Sparkles className="h-5 w-5 text-violet-700" />Plivex AI assistant</div><p className="mt-2 text-sm leading-6 text-slate-600">Ask business questions in Hindi or English, or use the assistant to review documents and workspace information. The existing assistant panel has been opened for you.</p></section>}
          {tab === "reports" && <ReportsTab />}
          {tab === "crm" && <CrmTab intent={intent} onConsumeIntent={consume} />}
          {tab === "stock" && <StockTab />}
          {tab === "warehouses" && <IndiaPart4Tab user={user} />}
          {tab === "team" && (teamUnlocked ? <TeamManagement /> : <div className="mx-auto max-w-lg rounded-2xl border border-[#E5E7EB] bg-white p-8 text-center shadow-sm"><Lock className="mx-auto h-8 w-8 text-[#6D28D9]" /><h2 className="mt-3 text-lg font-bold">Team management is a Pro feature</h2><p className="mt-2 text-sm text-slate-500">Upgrade to Pro to add and manage workspace members.</p><button onClick={openPaywall} className="mt-5 rounded-xl bg-[#6D28D9] px-5 py-2.5 text-sm font-bold text-white">Upgrade to Pro</button></div>)}
          {tab === "reconciliation" && <ReconciliationTab />}
        </main>
      </div>

      <nav aria-label="Primary workspace navigation" className="plivex-bottom-nav fixed inset-x-0 bottom-0 z-30 flex justify-around border-t border-[#E5E7EB] bg-white md:hidden">
        {mobilePrimaryTabs.map((t) => (
          <button key={t.id} onClick={() => go(t.id)} aria-current={tab === t.id ? "page" : undefined} className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 py-2.5 text-[10px] font-semibold transition-colors ${tab === t.id ? "text-[#6D28D9]" : "text-slate-400"}`}><t.icon className="h-5 w-5" /><span className="max-w-full truncate">{t.label}</span></button>
        ))}
      </nav>

      {accountOpen && <AccountProfileModal onClose={() => setAccountOpen(false)} />}
      <PresenceBeacon />
      <WelcomePopup userId={user?.id} planName={planName} plan={plan} planLoading={planLoading} />
      <ChatWidget />
      <AssistantWidget openOnMount={tab === "ai"} />

      {moreOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onClick={() => setMoreOpen(false)}>
          <section ref={moreDialogRef} role="dialog" aria-modal="true" aria-labelledby="workspace-pages-title" tabIndex={-1} className="flex max-h-[min(86dvh,760px)] w-full max-w-[560px] flex-col overflow-hidden rounded-t-2xl border border-[#E5E7EB] bg-white shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div><h3 id="workspace-pages-title" className="text-[15px] font-bold tracking-tight text-slate-900">Workspace tools</h3><p className="mt-0.5 text-[11px] text-slate-500">Open a workspace area or explore available tools.</p></div>
              <button type="button" onClick={() => setMoreOpen(false)} aria-label="Close workspace tools" className="rounded-lg border border-slate-200 p-2 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"><X className="h-4 w-4" /></button>
            </div>
            <div className="min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5">
              {secondaryTabs.length > 0 && <section className="mb-5"><h4 className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">More workspace tabs</h4><div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">{secondaryTabs.map((item) => <button key={item.id} type="button" onClick={() => { go(item.id); setMoreOpen(false); }} className="group flex min-h-[88px] flex-col items-start gap-2 rounded-xl border border-[#E5E7EB] bg-white p-3.5 text-left transition-colors hover:border-violet-300 hover:bg-violet-50/40"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50 text-slate-600 group-hover:bg-violet-50 group-hover:text-[#6D28D9]"><item.icon className="h-4 w-4" /></span><span className="text-[12px] font-semibold leading-snug text-slate-800">{item.label}</span></button>)}</div></section>}
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {morePages.map((p) => p.to === "/tax-summary" && !hasGstrAccess ? (
                  <button key={p.to} onClick={() => { setMoreOpen(false); openPaywall("Tax reporting is available on eligible plans."); }} className="group flex min-h-[104px] flex-col items-start gap-2 rounded-xl border border-[#E5E7EB] bg-white p-3.5 text-left transition-all hover:-translate-y-px hover:border-violet-300 hover:bg-violet-50/40 hover:shadow-sm">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-50 text-[#6D28D9] transition-colors group-hover:bg-violet-100"><p.icon className="h-4 w-4" /></span>
                    <span className="text-[12px] font-semibold leading-snug text-slate-800">{p.label}</span>
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-bold text-amber-800">BASIC / PRO</span>
                  </button>
                ) : (
                  <NavLink key={p.to} to={p.to} onClick={() => setMoreOpen(false)} className="group flex min-h-[104px] flex-col items-start gap-2 rounded-xl border border-[#E5E7EB] bg-white p-3.5 text-left transition-all hover:-translate-y-px hover:border-violet-300 hover:bg-violet-50/40 hover:shadow-sm">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-50 text-slate-600 transition-colors group-hover:bg-violet-50 group-hover:text-[#6D28D9]"><p.icon className="h-4 w-4" /></span>
                    <span className="text-[12px] font-semibold leading-snug text-slate-800">{p.label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}