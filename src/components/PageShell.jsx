export default function PageShell({ icon: Icon, title, subtitle, children, action }) {
  return (
    <div className="space-y-6 fade-up">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-5 gap-y-3 sm:items-end">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary"><Icon className="h-5 w-5" /></div>
          <div className="min-w-0">
            <h1 className="break-words text-[20px] font-bold tracking-[-0.04em] sm:text-[22px]">{title}</h1>
            {subtitle && <p className="break-words text-[12px] text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        {action && <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:justify-end">{action}</div>}
      </div>
      {children}
    </div>
  );
}
