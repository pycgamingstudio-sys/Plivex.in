import { BadgeCheck, CalendarDays, Check } from "lucide-react";

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// Shown on the pricing surfaces when the account already has an active paid plan:
// which plan it is, what it includes, and the plan's start and expiry dates.
export default function CurrentPlanCard({ planName, benefits = [], startedAt, expiresAt }) {
  return (
    <div className="mb-4 rounded-2xl border border-primary/30 bg-primary/[.04] p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><BadgeCheck className="h-3.5 w-3.5" /></span>
        <p className="font-mono-ui text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Your current plan</p>
      </div>
      <p className="mt-2 text-[18px] font-bold tracking-[-0.03em] text-foreground">{planName}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-[11px]">
          <CalendarDays className="h-3.5 w-3.5 text-primary" />
          <span className="text-muted-foreground">Started</span>
          <span className="ml-auto font-semibold text-foreground">{formatDate(startedAt)}</span>
        </div>
        <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-[11px]">
          <CalendarDays className="h-3.5 w-3.5 text-primary" />
          <span className="text-muted-foreground">Expires</span>
          <span className="ml-auto font-semibold text-foreground">{formatDate(expiresAt)}</span>
        </div>
      </div>
      {benefits.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {benefits.map((feature) => (
            <div key={feature} className="flex items-start gap-2 text-[11px] font-medium text-foreground">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Check className="h-2.5 w-2.5" /></span>{feature}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
