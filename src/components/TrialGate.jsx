import { Outlet } from "react-router-dom";
import { usePaywall } from "@/lib/paywall";
import SubscriptionLockScreen from "@/components/SubscriptionLockScreen";

// Absolute paywall: the moment the 14-day trial expires with no paid plan,
// every internal route locks and renders the mandatory upgrade screen.
// Legal & policy routes sit outside this gate and stay public.
// Works both as a layout route (renders <Outlet />) and around a single screen.
export default function TrialGate({ children }) {
  const { isPremium, trialActive, planLoading } = usePaywall();

  // Wait for the server-side plan check so a paid account never sees a flash of the lock.
  if (planLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-800"></div>
      </div>
    );
  }

  if (!isPremium && !trialActive) return <SubscriptionLockScreen />;
  return children ?? <Outlet />;
}