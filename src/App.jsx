import { Toaster } from "@/components/ui/toaster"
import { useToast } from "@/components/ui/use-toast"
import { lazy, Suspense, useEffect } from "react"
import LanguagePrompt from "@/components/LanguagePrompt"
import { startTranslator } from "@/lib/i18n"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import ScrollToTop from './components/ScrollToTop';
import ProtectedRoute from '@/components/ProtectedRoute';
import RoleGuard from '@/components/RoleGuard';
import { PaywallProvider, usePaywall } from '@/lib/paywall';
// Route-level lazy loading keeps the initial mobile bundle small.
const PageNotFound = lazy(() => import("./lib/PageNotFound"));
const UserNotRegisteredError = lazy(() => import("@/components/UserNotRegisteredError"));
const Login = lazy(() => import("./pages/Login"));
const Register = lazy(() => import("./pages/Register"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Home = lazy(() => import("./pages/Home"));
const InvoiceHistory = lazy(() => import("./pages/InvoiceHistory"));
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
const GuestDashboard = lazy(() => import("./pages/GuestDashboard"));
const ContactUs = lazy(() => import("./pages/ContactUs"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const TermsOfService = lazy(() => import("./pages/TermsOfService"));
const CancellationRefund = lazy(() => import("./pages/CancellationRefund"));
const HomeGate = lazy(() => import("./components/HomeGate"));
const AboutPage = lazy(() => import("./pages/PublicInfoPages").then((module) => ({ default: module.AboutPage })));
const FeaturesPage = lazy(() => import("./pages/PublicInfoPages").then((module) => ({ default: module.FeaturesPage })));
const PricingPage = lazy(() => import("./pages/PublicInfoPages").then((module) => ({ default: module.PricingPage })));
import AppLayout from './components/AppLayout';
import WorkspaceTeamProvider from '@/components/team/WorkspaceTeamProvider';
import TrialGate from './components/TrialGate';

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

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

  // Render the main app
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
      <Route path="/" element={<HomeGate />} />
      <Route path="/dashboard" element={<HomeGate />} />
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/" replace />} />}>
        <Route element={<TrialGate />}>
          <Route element={<RoleGuard />}>
            <Route path="/invoice-builder" element={<Home />} />
        <Route element={<AppLayout />}>
          <Route path="/invoice-history" element={<InvoiceHistory />} />
          <Route path="/business-profile" element={<BusinessProfile />} />
          <Route path="/client-database" element={<ClientDatabase />} />
          <Route path="/usage-reports" element={<UsageReports />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/templates" element={<QuickTemplates />} />
          <Route path="/payment-logs" element={<PaymentLogs />} />
          <Route path="/tax-summary" element={<TaxSummary />} />
          <Route path="/help-center" element={<HelpCenter />} />
          <Route path="/account-activity" element={<AccountActivity />} />
          <Route path="/service-catalog" element={<ServiceCatalog />} />
          <Route path="/team-management" element={<ProTeamRoute />} />
            </Route>
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

// Shows a message when a change could not be saved on the server (e.g. a role without permission).
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
      const message = String(e?.detail?.message || e?.detail?.error || "");
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