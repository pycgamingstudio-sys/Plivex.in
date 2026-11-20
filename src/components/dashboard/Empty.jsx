export function Empty({ label, action }) {
  return (
    <div className="plivex-empty-state" role="status">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50 to-indigo-50 text-[#6D28D9]" aria-hidden="true">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z"/><path d="m4.5 7.8 7.5 4.4 7.5-4.4M12 12.2V21"/></svg>
      </span>
      <p className="max-w-md text-[12px] font-medium leading-relaxed text-slate-600">{label}</p>
      {action}
    </div>
  );
}
