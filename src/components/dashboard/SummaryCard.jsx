export default function SummaryCard({ label, value, sub, gradient, icon: Icon, badge }) {
  return (
    <div className={`relative flex min-h-[120px] flex-col justify-between overflow-hidden rounded-2xl ${gradient} p-4 shadow-sm sm:aspect-video sm:p-5`}>
      <div className="flex items-center justify-between">
        {Icon && <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/20 text-white"><Icon className="h-5 w-5" /></span>}
        {badge && <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold text-white">{badge}</span>}
      </div>
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-white/80">{label}</p>
        <p className="mt-1 break-words text-[20px] font-bold leading-tight tracking-[-0.03em] text-white sm:text-[24px]">{value}</p>
        {sub && <p className="mt-1.5 text-[11px] font-medium text-white/70">{sub}</p>}
      </div>
    </div>
  );
}