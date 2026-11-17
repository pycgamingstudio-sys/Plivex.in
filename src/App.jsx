import { Toaster } from "@/components/ui/toaster"
import { useToast } from "@/components/ui/use-toast"
import { lazy, Suspense, useEffect } from "react"
import LanguagePrompt from "@/components/LanguagePrompt"
import { startTranslator } from "@/lib/i18n"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate, Link } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { APP_EDITION, isUnifiedBuild } from '@/api/backendClient';
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
const GlobalCountryOnboarding = lazy(() => import("@/components/global/GlobalCountryOnboarding"));
const UnifiedWorkspaceOnboarding = lazy(() => import("@/components/global/UnifiedWorkspaceOnboarding"));
const GlobalApp = lazy(() => import("@/global/GlobalApp"));
const Login = lazy(() => import("./pages/Login"));
const Register = lazy(() => import("./pages/Register"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Home = lazy(() => import("./pages/Home"));
const InvoiceHistory = lazy(() => import("./pages/InvoiceHistory"));
const InvoiceShareManagement = lazy(() => import("./pages/InvoiceShareManagement"));
const BusinessProfile = lazy(() => import("./pages/BusinessProfile"));
const ClientDatabase = lazy(() => import("./pages/ClientDatabase"));
const UsageReports = lazy(() => import("./pages/UsageReports"));
const Settings = lazy(() => import("./pages/Settings"));
const QuickTemplates = lazy(() => import("./pages/QuickTemplates"));
const PaymentLogs = lazy(() => import("./pages/PaymentLogs"));
const TaxSummary = lazy(() => import("./pages/TaxSummary"));
const HelpCenter = lazy(() => import("./pages/HelpCenter"));
const AccountActivity = lazy(() => import("./pages/AccountActivity"));
const ServiceCatalog = lazy(() => import("./pages/ServiceCatalog"));
const TeamManagement = lazy(() => import("./pages/TeamManagement"));
const CrmTab = lazy(() => import("@/components/dashboard/CrmTab"));
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

const AuthenticatedApp = () => {
  // Payment callbacks must remain visible even if the customer session expires during checkout.
  if (window.location.pathname === "/payment-result") {
    return <Routes><Route path="/payment-result" element={<PaymentResult />} /></Routes>;
  }

  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin, isAuthenticated, user } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
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
  if (isUnifiedBuild && isAuthenticated && user && !user.workspace_id && !getPendingInviteCode()) return <UnifiedWorkspaceOnboarding />;
  if (APP_EDITION === "global" && isAuthenticated && user && !user.workspace_id && !getPendingInviteCode()) return <GlobalCountryOnboarding />;

  // Both editions resolve core business destinations through this shared React Router tree.
  const isGlobalWorkspace = APP_EDITION === "global";

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
      <Route path="/" element={isGlobalWorkspace && isAuthenticated ? <Navigate to="/dashboard" replace /> : <HomeGate />} />
      <Route path="/dashboard" element={isGlobalWorkspace && isAuthenticated ? <AppLayout><GlobalApp section="overview" /></AppLayout> : <HomeGate />} />
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/" replace />} />}>
        <Route element={<TrialGate />}>
          <Route element={<RoleGuard />}>
            <Route path="/invoice-builder" element={isGlobalWorkspace ? <AppLayout><GlobalApp section="invoices" /></AppLayout> : <Home />} />
        <Route element={<AppLayout />}>
          <Route path="/products" element={isGlobalWorkspace ? <GlobalApp section="products" /> : <PageNotFound />} />
          <Route path="/expenses" element={isGlobalWorkspace ? <GlobalApp section="expenses" /> : <PageNotFound />} />
          <Route path="/accounting" element={isGlobalWorkspace ? <GlobalApp section="accounting" /> : <PageNotFound />} />
          <Route path="/enterprise" element={isGlobalWorkspace ? <GlobalApp section="enterprise" /> : <PageNotFound />} />
          <Route path="/invoice-history" element={isGlobalWorkspace ? <GlobalApp section="invoices" /> : <InvoiceHistory />} />
          <Route path="/invoice-shares" element={<GlobalFeatureGate feature="Shared invoice links"><InvoiceShareManagement /></GlobalFeatureGate>} />
          <Route path="/business-profile" element={<GlobalFeatureGate feature="Business profile"><BusinessProfile /></GlobalFeatureGate>} />
          <Route path="/client-database" element={isGlobalWorkspace ? <GlobalApp section="clients" /> : <ClientDatabase />} />
          <Route path="/crm" element={isGlobalWorkspace ? <GlobalApp section="crm" /> : <CrmTab />} />
          <Route path="/inventory-procurement" element={isGlobalWorkspace ? <GlobalApp section="inventory" /> : <IndiaPart4Tab user={user} />} />
          <Route path="/usage-reports" element={isGlobalWorkspace ? <GlobalApp section="accounting" /> : <UsageReports />} />
          <Route path="/settings" element={<GlobalFeatureGate feature="Workspace settings"><Settings /></GlobalFeatureGate>} />
          <Route path="/templates" element={<GlobalFeatureGate feature="Quick templates"><QuickTemplates /></GlobalFeatureGate>} />
          <Route path="/payment-logs" element={<GlobalFeatureGate feature="Payment logs"><PaymentLogs /></GlobalFeatureGate>} />
          <Route path="/tax-summary" element={<GlobalFeatureGate feature="Tax summary"><TaxSummary /></GlobalFeatureGate>} />
          <Route path="/help-center" element={<HelpCenter />} />
          <Route path="/account-activity" element={<GlobalFeatureGate feature="Account activity"><AccountActivity /></GlobalFeatureGate>} />
          <Route path="/service-catalog" element={<GlobalFeatureGate feature="Service catalog"><ServiceCatalog /></GlobalFeatureGate>} />
          <Route path="/team-management" element={<GlobalFeatureGate feature="Team management"><ProTeamRoute /></GlobalFeatureGate>} />
            </Route>
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

// Shows a message when a change could not be saved on the server (e.g. a role without permission).

function GlobalFeatureGate({ children, feature }) {
  const { user } = useAuth();
  if (APP_EDITION === "global" && user?.country_code !== "IN") {
    return (
      <main className="mx-auto max-w-xl rounded-2xl border bg-card p-6 text-center">
        <p className="text-xs font-bold uppercase tracking-wider text-primary">Global workspace</p>
        <h1 className="mt-2 text-xl font-bold">{feature} is not available yet</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This feature is still being adapted for your workspace country. We have hidden the India-only version so it cannot show incorrect tax, currency or business records.
        </p>
        <Link to="/invoice-history" className="mt-5 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
          Open Global invoices
        </Link>
      </main>
    );
  }
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