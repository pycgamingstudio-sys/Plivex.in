export default function PageShell({ icon: Icon, title, subtitle, children, action }) {
  return (
    <div className="min-w-0 space-y-5 fade-up sm:space-y-6">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-5 gap-y-3 rounded-2xl border border-[#E8E7EF] bg-white/80 p-3.5 shadow-[0_1px_2px_rgba(24,24,40,.025)] sm:items-end sm:p-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-100 to-indigo-100 text-primary ring-1 ring-violet-200/60"><Icon className="h-5 w-5" /></div>
          <div className="min-w-0">
            <h1 className="break-words text-[19px] font-bold tracking-[-0.035em] text-slate-900 sm:text-[22px]">{title}</h1>
            {subtitle && <p className="mt-0.5 break-words text-[11px] leading-relaxed text-slate-500 sm:text-[12px]">{subtitle}</p>}
          </div>
        </div>
        {action && <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:justify-end">{action}</div>}
      </div>
      {children}
    </div>
  );
}
