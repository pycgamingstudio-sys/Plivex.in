import { useEffect, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { LayoutDashboard, ReceiptText, BookOpen, Sparkles, MoreHorizontal } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { APP_EDITION, isUnifiedBuild } from "@/api/backendClient";
import AppLayout from "@/components/AppLayout";
import Logo from "@/components/Logo";
import { lazy } from "react";
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const GlobalApp = lazy(() => import("@/global/GlobalApp"));
const GuestDashboard = lazy(() => import("@/pages/GuestDashboard"));
import TrialGate from "@/components/TrialGate";

// Public landing gate: guests land on the demo dashboard without any account;
// authenticated users land on their real workspace. Pending guest intents
// (stored before sign-in) are resumed automatically.
export default function HomeGate({ initialTab: routeInitialTab }) {
  const { isAuthenticated, isLoadingAuth, isLoadingPublicSettings, user } = useAuth();
  const location = useLocation();
  const [pending, setPending] = useState(null);

  useEffect(() => {
    if (isAuthenticated) {
      try {
        const p = sessionStorage.getItem("plivex:pendingAction");
        if (p) { sessionStorage.removeItem("plivex:pendingAction"); setPending(p); }
      } catch { /* ignore */ }
    }
  }, [isAuthenticated]);

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="plivex-auth-shell fixed inset-0 flex flex-col items-center justify-center gap-3" role="status" aria-label="Loading Plivex">
        <Logo className="h-12 w-12" />
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-violet-100 border-t-[#6D28D9]" aria-hidden="true" />
        <span className="text-xs font-semibold text-slate-500">Preparing your Plivex workspace…</span>
      </div>
    );
  }

  if (!isAuthenticated) return <GuestDashboard />;
  // A unified Plivex build always uses the canonical Main Workspace UI.
  // Non-India country settings must never route an account into GlobalApp.
  const isGlobalWorkspace = !isUnifiedBuild && APP_EDITION === "global";

  if (pending === "create-invoice") return <Navigate to="/invoice-builder" replace />;
  if (isGlobalWorkspace) return <TrialGate><AppLayout><GlobalApp section="overview" /></AppLayout></TrialGate>;
  if (pending === "settings") return <Navigate to="/settings" replace />;
  // The workspace dashboard is an internal screen, so it sits behind the same
  // Apply the same plan-limit recovery banner as other internal routes; expired subscriptions fall back to Free.
  const routeState = location.state && typeof location.state === "object" ? location.state : {};
  const dashboard = pending === "add-stock" ? <Dashboard initialTab="stock" />
    : pending === "open-crm" ? <Dashboard initialTab="crm" />
      : pending === "export-gst" ? <Dashboard initialTab="sales" />
        : <Dashboard
            initialTab={routeInitialTab === "more" ? "dashboard" : (routeInitialTab || (typeof routeState.initialTab === "string" ? routeState.initialTab : undefined))}
            openMoreOnMount={routeInitialTab === "more"}
            initialSub={typeof routeState.initialSub === "string" ? routeState.initialSub : undefined}
            initialIntent={typeof routeState.initialIntent === "string" ? routeState.initialIntent : undefined}
          />;
  const mobileItems = [
    { to: "/workspace/dashboard", label: "Home", Icon: LayoutDashboard, active: ["/", "/dashboard", "/workspace/dashboard"].includes(location.pathname) },
    { to: "/workspace/sales", label: "Sales", Icon: ReceiptText, active: location.pathname === "/workspace/sales" },
    { to: "/workspace/books", label: "Books", Icon: BookOpen, active: location.pathname === "/workspace/books" },
    { to: "/workspace/ai", label: "AI", Icon: Sparkles, active: location.pathname === "/workspace/ai" },
    { to: "/workspace/more", label: "More", Icon: MoreHorizontal, active: location.pathname === "/workspace/more" },
  ];
  const visibleMobileItems = mobileItems.filter((item) => {
    if (item.to === "/workspace/books") return ["admin", "manager", "accountant"].includes(user?.role);
    return true;
  });
  return <TrialGate><div className="plivex-route-shell">{dashboard}
    <style>{".plivex-route-shell .plivex-bottom-nav{display:none!important}"}</style>
    <nav aria-label="Main workspace navigation" className="fixed inset-x-0 bottom-0 z-[45] grid border-t border-slate-200 bg-white/95 shadow-[0_-8px_28px_rgba(24,24,40,.08)] backdrop-blur-xl md:hidden" style={{gridTemplateColumns:"repeat("+visibleMobileItems.length+", minmax(0, 1fr))",paddingBottom:"env(safe-area-inset-bottom, 0px)"}}>
      {visibleMobileItems.map(({to,label,Icon,active})=><Link key={to} to={to} aria-current={active?"page":undefined} className={"flex min-h-[62px] flex-col items-center justify-center gap-1 px-1 py-2 text-[10px] font-semibold transition-colors "+(active?"text-violet-700":"text-slate-500 hover:text-slate-900")}>
        <Icon className="h-5 w-5" strokeWidth={active?2.4:1.8}/><span className="max-w-full truncate">{label}</span>
      </Link>)}
    </nav>
  </div></TrialGate>;
}