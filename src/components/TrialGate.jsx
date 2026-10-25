import { Outlet } from "react-router-dom";
import { usePaywall } from "@/lib/paywall";

// Access is decided by the server; Free is a real plan and must not be hard-locked.
export default function TrialGate({ children }) {
  const { planLoading } = usePaywall();

  if (planLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-800" />
      </div>
    );
  }

  return children ?? <Outlet />;
}
