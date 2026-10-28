import { Outlet } from "react-router-dom";
import { usePaywall } from "@/lib/paywall";

// Access is decided by the server; Free is a real plan and must not be hard-locked.
export default function TrialGate({ children }) {
  const { planLoading, overLimit, openPaywall, planName } = usePaywall();

  if (planLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-800" />
      </div>
    );
  }

  if (overLimit) {
    return (
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-50 p-5">
        <div className="w-full max-w-md rounded-2xl border border-amber-200 bg-white p-6 text-center shadow-xl">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <span className="text-2xl font-bold">!</span>
          </div>
          <h1 className="mt-4 text-xl font-bold text-slate-900">Upgrade required to continue</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Your workspace is over the {planName || "current"} plan limits. Your saved records are safe, but Plivex is locked until you upgrade.
          </p>
          <button
            type="button"
            onClick={() => openPaywall("Your workspace has exceeded its plan limits. Upgrade to restore app access.")}
            className="mt-5 w-full rounded-xl bg-[#6D28D9] px-4 py-3 text-sm font-bold text-white"
          >
            View upgrade plans
          </button>
        </div>
      </div>
    );
  }

  return children ?? <Outlet />;
}
