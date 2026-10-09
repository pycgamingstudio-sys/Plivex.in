import { Toaster } from "@/components/ui/toaster"
import { useToast } from "@/components/ui/use-toast"
import { useEffect } from "react"
import LanguagePrompt from "@/components/LanguagePrompt"
import { startTranslator } from "@/lib/i18n"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
import ProtectedRoute from '@/components/ProtectedRoute';
import RoleGuard from '@/components/RoleGuard';
import { PaywallProvider } from '@/lib/paywall';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
// Add page imports here
import Home from './pages/Home';
import AppLayout from './components/AppLayout';
import InvoiceHistory from './pages/InvoiceHistory';
import BusinessProfile from './pages/BusinessProfile';
import ClientDatabase from './pages/ClientDatabase';
import UsageReports from './pages/UsageReports';
import Settings from './pages/Settings';
import QuickTemplates from './pages/QuickTemplates';
import PaymentLogs from './pages/PaymentLogs';
import TaxSummary from './pages/TaxSummary';
import HelpCenter from './pages/HelpCenter';
import AccountActivity from './pages/AccountActivity';
import ServiceCatalog from './pages/ServiceCatalog';
import TeamManagement from './pages/TeamManagement';
import HomeGate from './components/HomeGate';
import WorkspaceTeamProvider from '@/components/team/WorkspaceTeamProvider';
import GuestDashboard from './pages/GuestDashboard';
import TrialGate from './components/TrialGate';
import ContactUs from './pages/ContactUs';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfService from './pages/TermsOfService';
import CancellationRefund from './pages/CancellationRefund';

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
      <Route path="/about" element={<GuestDashboard />} />
      <Route path="/pricing" element={<GuestDashboard />} />
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
          <Route path="/team-management" element={<TeamManagement />} />
            </Route>
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

// Shows a message when a change could not be saved on the server (e.g. a role without permission).
function SyncErrorListener() {
  const { toast } = useToast();
  useEffect(() => {
    const onError = (e) => toast({ title: "Could not save your change", description: e?.detail?.message || "Please try again.", variant: "destructive" });
    window.addEventListener("plivex-sync-error", onError);
    return () => window.removeEventListener("plivex-sync-error", onError);
  }, [toast]);
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
              <AuthenticatedApp />
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