import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { APP_EDITION, isUnifiedBuild } from "@/api/backendClient";
import AppLayout from "@/components/AppLayout";
import { lazy } from "react";
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const GlobalApp = lazy(() => import("@/global/GlobalApp"));
const GuestDashboard = lazy(() => import("@/pages/GuestDashboard"));
import TrialGate from "@/components/TrialGate";

// Public landing gate: guests land on the demo dashboard without any account;
// authenticated users land on their real workspace. Pending guest intents
// (stored before sign-in) are resumed automatically.
export default function HomeGate() {
  const { isAuthenticated, isLoadingAuth, isLoadingPublicSettings } = useAuth();
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
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
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
            initialTab={typeof routeState.initialTab === "string" ? routeState.initialTab : undefined}
            initialSub={typeof routeState.initialSub === "string" ? routeState.initialSub : undefined}
            initialIntent={typeof routeState.initialIntent === "string" ? routeState.initialIntent : undefined}
          />;
  return <TrialGate>{dashboard}</TrialGate>;
}