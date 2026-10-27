import { BadgeCheck, Check } from "lucide-react";

// Shown on pricing surfaces for the current plan and included benefits. Dates are intentionally omitted for every plan tier.
export default function CurrentPlanCard({ planName, benefits = [] }) {
  return (
    <div className="mb-4 rounded-2xl border border-primary/30 bg-primary/[.04] p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><BadgeCheck className="h-3.5 w-3.5" /></span>
        <p className="font-mono-ui text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Your current plan</p>
      </div>
      <p className="mt-2 text-[18px] font-bold tracking-[-0.03em] text-foreground">{planName}</p>
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
