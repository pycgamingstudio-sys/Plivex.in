export default function PageShell({ icon: Icon, title, subtitle, children, action }) {
  return (
    <div className="space-y-6 fade-up">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-primary"><Icon className="h-5 w-5" /></div>
          <div>
            <h1 className="text-[22px] font-bold tracking-[-0.04em]">{title}</h1>
            {subtitle && <p className="text-[12px] text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
