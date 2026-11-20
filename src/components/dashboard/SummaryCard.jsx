export default function SummaryCard({ label, value, sub, gradient, icon: Icon, badge }) {
  return (
    <div className={`plivex-hover-lift relative flex min-h-[116px] flex-col justify-between overflow-hidden rounded-2xl ${gradient} p-4 shadow-sm ring-1 ring-black/[.035] sm:min-h-[132px] sm:p-5`}>
      <div className="flex items-center justify-between gap-2">
        {Icon && <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/20 text-white"><Icon className="h-5 w-5" /></span>}
        {badge && <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold text-white">{badge}</span>}
      </div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/85 sm:text-[11px]">{label}</p>
        <p className="mt-1 break-words text-[clamp(1.15rem,2vw,1.5rem)] font-bold leading-tight tracking-[-0.035em] text-white">{value}</p>
        {sub && <p className="mt-1.5 break-words text-[10px] font-medium leading-relaxed text-white/80 sm:text-[11px]">{sub}</p>}
      </div>
    </div>
  );
}