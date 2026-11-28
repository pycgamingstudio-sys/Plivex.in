import { Toaster } from "@/components/ui/toaster"
import { useToast } from "@/components/ui/use-toast"
import { lazy, Suspense, useEffect } from "react"
import LanguagePrompt from "@/components/LanguagePrompt"
import { startTranslator } from "@/lib/i18n"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate, Link } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { isUnifiedBuild } from '@/api/backendClient';
import { useWorkspaceFeatures } from "@/lib/workspaceFeatures";
import ScrollToTop from './components/ScrollToTop';
import ProtectedRoute from '@/components/ProtectedRoute';
import RoleGuard from '@/components/RoleGuard';
import { PaywallProvider, usePaywall } from '@/lib/paywall';
import AppLayout from './components/AppLayout';
import WorkspaceTeamProvider from '@/components/team/WorkspaceTeamProvider';
import TrialGate from './components/TrialGate';
import { getPendingInviteCode } from "@/components/auth/workspaceInvite";
// Route-level lazy loading keeps the initial mobile bundle small.
const PageNotFound = lazy(() => import("./lib/PageNotFound"));
const UserNotRegisteredError = lazy(() => import("@/components/UserNotRegisteredError"));
const UnifiedWorkspaceOnboarding = lazy(() => import("@/components/global/UnifiedWorkspaceOnboarding"));
const Login = lazy(() => import("./pages/Login"));
const Register = lazy(() => import("./pages/Register"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Home = lazy(() => import("./pages/Home"));
const InvoiceHistory = lazy(() => import("./pages/InvoiceHistory"));
const InvoiceShareManagement = lazy(() => import("./pages/InvoiceShareManagement"));
const BusinessProfile = lazy(() => import("./pages/BusinessProfile"));
const UsageReports = lazy(() => import("./pages/UsageReports"));
const Settings = lazy(() => import("./pages/Settings"));
const QuickTemplates = lazy(() => import("./pages/QuickTemplates"));
const PaymentLogs = lazy(() => import("./pages/PaymentLogs"));
const TaxSummary = lazy(() => import("./pages/TaxSummary"));
const HelpCenter = lazy(() => import("./pages/HelpCenter"));
const AccountActivity = lazy(() => import("./pages/AccountActivity"));
const ServiceCatalog = lazy(() => import("./pages/ServiceCatalog"));
const TeamManagement = lazy(() => import("./pages/TeamManagement"));
const WorkspaceCRMPanel = lazy(() => import("@/components/workspace/WorkspaceCRMPanel"));
const IndiaPart4Tab = lazy(() => import("@/components/dashboard/IndiaPart4Tab"));
const ContactUs = lazy(() => import("./pages/ContactUs"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const TermsOfService = lazy(() => import("./pages/TermsOfService"));
const CancellationRefund = lazy(() => import("./pages/CancellationRefund"));
const HomeGate = lazy(() => import("./components/HomeGate"));
const AboutPage = lazy(() => import("./pages/PublicInfoPages").then((module) => ({ default: module.AboutPage })));
const FeaturesPage = lazy(() => import("./pages/PublicInfoPages").then((module) => ({ default: module.FeaturesPage })));
const PricingPage = lazy(() => import("./pages/PublicInfoPages").then((module) => ({ default: module.PricingPage })));
const PaymentResult = lazy(() => import("./pages/PaymentResult"));
const PublicInvoicePage = lazy(() => import("./pages/PublicInvoicePage"));
const SupplierPortalPage = lazy(() => import("./pages/SupplierPortalPage"));
const WorkspacePlatformPage = lazy(() => import("./pages/WorkspacePlatformPage"));
const PublicSignaturePage = lazy(() => import("./pages/PublicSignaturePage"));
const PublicSupplierOnboardingPage = lazy(() => import("./pages/PublicSupplierOnboardingPage"));

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin, isAuthenticated, user, logout } = useAuth();

  // Payment callbacks must remain visible even if the customer session expires during checkout.
  // Keep hooks unconditional so navigating to/from this public callback never changes hook order.
  if (window.location.pathname === "/supplier-portal") {
    return <Routes><Route path="/supplier-portal" element={<SupplierPortalPage />} /></Routes>;
  }

  if (window.location.pathname === "/payment-result") {
    return <Routes><Route path="/payment-result" element={<PaymentResult />} /></Routes>;
  }

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center" role="status" aria-label="Loading your Plivex workspace">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-[#6D28D9]" aria-hidden="true"></div>
        <span className="sr-only">Loading your Plivex workspace…</span>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required' && !['/login', '/register', '/forgot-password', '/reset-password'].includes(window.location.pathname)) {
      // Keep Plivex's authentication pages accessible when a session expires.
      navigateToLogin();
      return null;
    }
  }

  // One shared post-auth onboarding provisions either regional workspace.
  if (isUnifiedBuild && isAuthenticated && user && (!user.workspace_id || !user.country_code || !user.workspace_type || Number(user.onboarding_version || 0) < 1) && (!getPendingInviteCode() || Boolean(user.workspace_id))) {
    const canProvisionWorkspace = !user.workspace_id || !user.role || user.role === "admin" || user.role === "user";
    if (canProvisionWorkspace) return <UnifiedWorkspaceOnboarding />;
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <h1 className="text-lg font-bold">Workspace setup is pending</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Workspace setup is incomplete. Contact your workspace owner for help. Your account and existing records remain preserved.</p>
          <button type="button" onClick={() => logout()} className="mt-5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Sign out</button>
        </div>
      </main>
    );
  }

  // All supported countries use the same Main Workspace routes. Country only selects regional settings.

  // Render the shared application routes
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/privacy-policy" element={<PrivacyPolicy />} />
      <Route path="/terms-of-service" element={<TermsOfService />} />
      <Route path="/terms-and-conditions" element={<TermsOfService />} />
      <Route path="/cancellation-and-refund" element={<CancellationRefund />} />
      <Route path="/refund-and-cancellation" element={<CancellationRefund />} />
      <Route path="/contact-us" element={<ContactUs />} />
      <Route path="/about" element={<AboutPage />} />
      <Route path="/features" element={<FeaturesPage />} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/i/:token" element={<PublicInvoicePage />} />
      <Route path="/sign/:token" element={<PublicSignaturePage />} />
      <Route path="/supplier-onboarding/:token" element={<PublicSupplierOnboardingPage />} />
      <Route path="/" element={<HomeGate />} />
      <Route path="/dashboard" element={<HomeGate />} />
      <Route path="/workspace/dashboard" element={<HomeGate initialTab="dashboard" />} />
      <Route path="/workspace/sales" element={<HomeGate initialTab="sales" />} />
      <Route path="/workspace/books" element={<HomeGate initialTab="books" />} />
      <Route path="/workspace/ai" element={<HomeGate initialTab="ai" />} />
      <Route path="/workspace/more" element={<HomeGate initialTab="more" />} />
      <Route path="/workspace/purchase" element={<HomeGate initialTab="purchase" />} />
      <Route path="/workspace/reports" element={<HomeGate initialTab="reports" />} />
      <Route path="/workspace/crm" element={<HomeGate initialTab="crm" />} />
      <Route path="/workspace/stock" element={<HomeGate initialTab="stock" />} />
      <Route path="/workspace/warehouses" element={<HomeGate initialTab="warehouses" />} />
      <Route path="/workspace/reconciliation" element={<HomeGate initialTab="reconciliation" />} />
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/" replace />} />}>
        <Route element={<TrialGate />}>
          <Route element={<RoleGuard />}>
            <Route path="/invoice-builder" element={<Home />} />
        <Route element={<AppLayout />}>
          <Route path="/products" element={<Navigate to="/dashboard" replace state={{ initialTab: "stock" }} />} />
          <Route path="/expenses" element={<Navigate to="/dashboard" replace state={{ initialTab: "purchase" }} />} />
          <Route path="/accounting" element={<Navigate to="/workspace/books" replace />} />
          <Route path="/enterprise" element={<Navigate to="/dashboard" replace state={{ initialTab: "team" }} />} />
          <Route path="/invoice-history" element={<InvoiceHistory />} />
          <Route path="/quotations" element={<Navigate to="/dashboard" replace state={{ initialTab: "sales", initialSub: "quotations" }} />} />
          <Route path="/invoice-shares" element={<GlobalFeatureGate feature="Shared invoice links"><InvoiceShareManagement /></GlobalFeatureGate>} />
          <Route path="/business-profile" element={<GlobalFeatureGate feature="Business profile"><BusinessProfile /></GlobalFeatureGate>} />
          <Route path="/client-database" element={<WorkspaceFeatureGate anyOf={["crm", "leads"]}><WorkspaceCRMPanel initialTab="clients" /></WorkspaceFeatureGate>} />
          <Route path="/crm" element={<WorkspaceFeatureGate anyOf={["crm", "leads"]}><WorkspaceCRMPanel initialTab="leads" /></WorkspaceFeatureGate>} />
          <Route path="/sales-documents" element={<Navigate to="/dashboard" replace state={{ initialTab: "sales" }} />} />
          <Route path="/suppliers" element={<Navigate to="/platform" replace />} />
          <Route path="/inventory-procurement" element={<WorkspaceFeatureGate feature="inventoryWorkspace"><IndiaPart4Tab user={user} /></WorkspaceFeatureGate>} />
          <Route path="/usage-reports" element={<GlobalFeatureGate feature="Usage reports"><WorkspaceFeatureGate feature="reports"><UsageReports /></WorkspaceFeatureGate></GlobalFeatureGate>} />
          <Route path="/settings" element={<GlobalFeatureGate feature="Workspace settings"><Settings /></GlobalFeatureGate>} />
          <Route path="/templates" element={<GlobalFeatureGate feature="Quick templates"><QuickTemplates /></GlobalFeatureGate>} />
          <Route path="/payment-logs" element={<GlobalFeatureGate feature="Payment logs"><WorkspaceFeatureGate feature="expenses"><PaymentLogs /></WorkspaceFeatureGate></GlobalFeatureGate>} />
          <Route path="/tax-summary" element={<GlobalFeatureGate feature="Tax summary"><WorkspaceFeatureGate feature="reports"><TaxSummary /></WorkspaceFeatureGate></GlobalFeatureGate>} />
          <Route path="/help-center" element={<HelpCenter />} />
          <Route path="/account-activity" element={<GlobalFeatureGate feature="Account activity"><WorkspaceFeatureGate feature="reports"><AccountActivity /></WorkspaceFeatureGate></GlobalFeatureGate>} />
          <Route path="/service-catalog" element={<GlobalFeatureGate feature="Service catalog"><ServiceCatalog /></GlobalFeatureGate>} />
          <Route path="/team-management" element={<GlobalFeatureGate feature="Team management"><WorkspaceFeatureGate feature="team"><ProTeamRoute /></WorkspaceFeatureGate></GlobalFeatureGate>} />
          <Route path="/platform" element={<WorkspacePlatformPage />} />
          <Route path="/platform/:group" element={<WorkspacePlatformPage />} />
          <Route path="/platform/:group/:tool" element={<WorkspacePlatformPage />} />
            </Route>
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

// Shows a message when a change could not be saved on the server (e.g. a role without permission).

function WorkspaceFeatureGate({ children, feature, anyOf = [], businessOnly = false }) {
  const { user } = useAuth();
  const { features, ready } = useWorkspaceFeatures(user?.workspace_id);
  if (!isUnifiedBuild) return children;
  if (!ready) return <main className="mx-auto max-w-xl p-6 text-sm text-muted-foreground" role="status">Loading Workspace features…</main>;
  if (businessOnly && user?.workspace_type !== "business") return <Navigate to="/dashboard" replace />;
  if (feature && !features.includes(feature) && !(user?.workspace_type === "business" && ["stock", "team"].includes(feature))) return <Navigate to="/dashboard" replace />;
  if (anyOf.length && !anyOf.some((item) => features.includes(item))) return <Navigate to="/dashboard" replace />;
  return children;
}

function GlobalFeatureGate({ children }) {
  return children;
}
function ProTeamRoute() {
  const { canAccess, openPaywall } = usePaywall();
  useEffect(() => { if (!canAccess("team_management")) openPaywall("Team management requires the Pro plan."); }, [canAccess, openPaywall]);
  return canAccess("team_management") ? <TeamManagement /> : <div className="mx-auto max-w-lg p-8 text-center"><h2 className="text-xl font-bold">Team management is a Pro feature</h2><p className="mt-2 text-sm text-slate-500">Upgrade to Pro to manage team members.</p><button onClick={() => openPaywall("Team management requires the Pro plan.")} className="mt-4 rounded-xl bg-[#6D28D9] px-5 py-2 text-sm font-bold text-white">Upgrade to Pro</button></div>;
}

function SyncErrorListener() {
  const { toast } = useToast();
  const { openPaywall, planName, plan, limits, usage } = usePaywall();
  useEffect(() => {
    const onError = (e) => {
      const detail = e?.detail;
      const rawMessage = typeof detail === "string" ? detail : (detail?.message ?? detail?.error ?? "");
      const message = typeof rawMessage === "string" ? rawMessage : String(rawMessage ?? "");
      if (message.startsWith("PLAN_LIMIT_REACHED|") || message.startsWith("PLAN_FEATURE_LOCKED|")) {
        if (typeof e?.detail?.rollback === "function") { try { e.detail.rollback(); } catch { /* best-effort optimistic rollback */ } }
        const parts = message.split("|").map((part) => part.trim());
        const resource = parts[1] || "requested resource";
        const limit = parts[2] || limits[resource] || "plan limit";
        const current = planName || plan || "Free";
        const unlocks = message.startsWith("PLAN_FEATURE_LOCKED|") ? "Pro" : (parts[4] || (current === "Free" ? "Basic or Pro" : "Pro"));
        const reason = message.startsWith("PLAN_LIMIT_REACHED|")
          ? `${resource} limit: ${limit}. Current plan: ${current}. Unlock with: ${unlocks}.`
          : `Feature: ${resource}. Current plan: ${current}. Unlock with: ${unlocks}.`;
        openPaywall(reason);
        toast({ title: "Upgrade required", description: reason, variant: "destructive" });
        return;
      }
      toast({ title: "Could not save your change", description: message || "Please try again.", variant: "destructive" });
    };
    window.addEventListener("plivex-sync-error", onError);
    return () => window.removeEventListener("plivex-sync-error", onError);
  }, [toast, openPaywall]);
  return null;
}

function App() {
  useEffect(() => { startTranslator(); }, []);

  // India and Global workspaces share this router, auth provider and dashboard shell.

  return (
    <AuthProvider>
      <PaywallProvider>
        <QueryClientProvider client={queryClientInstance}>
          <WorkspaceTeamProvider>
            <Router>
              <ScrollToTop />
              <Suspense fallback={<div className="fixed inset-0 flex items-center justify-center bg-background"><div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-800" role="status" aria-label="Loading page" /></div>}><AuthenticatedApp /></Suspense>
            </Router>
          </WorkspaceTeamProvider>
          <Toaster />
          <SyncErrorListener />
          <LanguagePrompt />
        </QueryClientProvider>
      </PaywallProvider>
    </AuthProvider>
  )
}

export default App