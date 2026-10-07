import { Check, Lock } from "lucide-react";
import { INVOICE_DESIGNS } from "@/components/invoice/designs";

function Swatch({ id }) {
  const base = "h-10 w-full overflow-hidden rounded-md border border-black/5 bg-white";
  if (id === "modern") return (<div className={base}><div className="h-3.5 w-full bg-[#6D28D9]" /><div className="space-y-1 p-2"><div className="h-0.5 w-full bg-slate-200" /><div className="h-0.5 w-2/3 bg-slate-200" /></div></div>);
  if (id === "minimal") return (<div className={base}><div className="p-2.5"><div className="h-px w-full bg-slate-300" /><div className="mt-2 space-y-1.5"><div className="h-0.5 w-1/3 bg-slate-200" /><div className="h-0.5 w-2/3 bg-slate-200" /><div className="h-0.5 w-1/2 bg-slate-200" /></div></div></div>);
  if (id === "executive") return (<div className={`${base} flex`}><div className="w-1/4 bg-[#2e2857]" /><div className="flex-1 space-y-1 p-2"><div className="h-0.5 w-full bg-slate-200" /><div className="h-0.5 w-2/3 bg-slate-200" /><div className="h-0.5 w-1/2 bg-slate-200" /></div></div>);
  if (id === "elegant") return (<div className={base}><div className="p-2.5"><div className="mx-auto h-0.5 w-1/2 bg-[#b9a86a]" /><div className="mx-auto mt-1.5 h-px w-1/3 bg-slate-300" /><div className="mt-2 space-y-1"><div className="h-0.5 w-full bg-slate-200" /><div className="h-0.5 w-full bg-slate-200" /></div></div></div>);
  return (<div className={base}><div className="p-2.5"><div className="h-1 w-2/3 bg-[#2e2857]" /><div className="mt-1.5 space-y-1"><div className="h-0.5 w-full bg-slate-200" /><div className="h-0.5 w-full bg-slate-200" /><div className="h-0.5 w-1/2 bg-slate-200" /></div></div></div>);
}

// Lets the user pick the invoice layout. Free designs are open to everyone; the
// premium ones are Pro-only and open the upgrade screen when tapped.
export default function DesignPicker({ value, onChange, canPremium, onLocked }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
      {INVOICE_DESIGNS.map((design) => {
        const locked = design.premium && !canPremium;
        const active = value === design.id;
        return (
          <button
            key={design.id}
            type="button"
            data-testid={`button-design-${design.id}`}
            onClick={() => (locked ? onLocked() : onChange(design.id))}
            className={`rounded-xl border p-2.5 text-left transition-colors ${active ? "border-primary bg-primary/[.04]" : "hover:border-primary/40"}`}
          >
            <Swatch id={design.id} />
            <div className="mt-2 flex items-center gap-1.5">
              <span className="text-[12px] font-bold">{design.label}</span>
              {locked && <span className="ml-auto flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 font-mono-ui text-[9px] font-bold uppercase text-primary"><Lock className="h-2.5 w-2.5" />Pro</span>}
              {active && !locked && <span className="ml-auto flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground"><Check className="h-2.5 w-2.5" /></span>}
            </div>
            <p className="mt-0.5 text-[10px] text-muted-foreground">{design.blurb}</p>
          </button>
        );
      })}
    </div>
  );
}