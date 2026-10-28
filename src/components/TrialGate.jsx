import { Outlet } from "react-router-dom";
import { usePaywall } from "@/lib/paywall";

// Keep the workspace accessible when a downgrade leaves saved records above the
// new plan's limits. The backend blocks new over-limit inserts; users must still
// be able to review, edit, export, and delete their existing data to recover.
export default function TrialGate({ children }) {
  const { planLoading, overLimit, openPaywall, planName } = usePaywall();

  if (planLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-800" />
      </div>
    );
  }

  return (
    <>
      {overLimit && (
        <div role="status" className="sticky top-0 z-[80] border-b border-amber-200 bg-amber-50 px-4 py-3 text-amber-950">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
            <p className="text-sm leading-5">
              <strong>{planName || "Current"} plan limit exceeded.</strong>{" "}
              Your saved records are safe. Remove extras to return within Free limits, or upgrade for more capacity. New records above your limit may be blocked.
            </p>
            <button
              type="button"
              onClick={() => openPaywall("Your workspace has exceeded its plan limits. Upgrade for more capacity, or return to the plan limits.")}
              className="shrink-0 rounded-lg bg-[#6D28D9] px-3 py-2 text-xs font-bold text-white"
            >
              View plans
            </button>
          </div>
        </div>
      )}
      {children ?? <Outlet />}
    </>
  );
}
