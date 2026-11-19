import { X } from "lucide-react";
import { getAvailableWorkspaceFeatureCatalog } from "@/lib/workspaceFeatures";
import { APP_EDITION } from "@/api/backendClient";

export default function FeatureLibraryModal({ features, permanentFeatures = [], updateFeatures, saving, error, onClose }) {
  const toggle = async (id) => {
    if (permanentFeatures.includes(id)) return;
    const next = features.includes(id) ? features.filter((item) => item !== id) : [...features, id];
    await updateFeatures(next);
  };
  const catalog = getAvailableWorkspaceFeatureCatalog(APP_EDITION);
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center overflow-y-auto bg-slate-950/45 p-2 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="feature-library-title" className="my-1 flex max-h-[calc(100dvh-0.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl sm:my-0 sm:max-h-[min(90dvh,820px)] sm:rounded-3xl" onClick={(event) => event.stopPropagation()}>
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-6 sm:py-5">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-violet-700">Plivex workspace · Complete feature library</p>
            <h2 id="feature-library-title" className="mt-1 text-lg font-bold leading-6 text-slate-900 sm:text-xl">All your business tools, in one place.</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500 sm:text-sm">Your Freelancer or Business setup only changes suggested tools. Every module remains available here.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close feature library" className="shrink-0 rounded-xl p-2 text-slate-400 transition hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
          <div className="grid gap-3 sm:grid-cols-2">
            {catalog.map((item) => {
              const permanent = item.core === true || permanentFeatures.includes(item.id);
              const enabled = permanent || features.includes(item.id);
              return (
                <article key={item.id} className={`flex min-w-0 flex-col rounded-2xl border p-4 transition-colors ${enabled ? "border-violet-200 bg-violet-50/40" : "border-slate-200 bg-white"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="break-words text-sm font-bold text-slate-900">{item.label}</h3>
                      <p className="mt-1 text-xs leading-5 text-slate-500">{item.description}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${permanent ? "bg-slate-100 text-slate-600" : enabled ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-500"}`}>
                      {permanent ? "Core module" : enabled ? "Added" : "Available"}
                    </span>
                  </div>
                  <button type="button" disabled={saving || permanent} onClick={() => toggle(item.id)} className={`mt-4 min-h-10 w-full rounded-xl px-3 text-xs font-bold transition disabled:cursor-default ${permanent ? "border border-slate-200 bg-slate-50 text-slate-500" : enabled ? "border border-violet-200 bg-white text-violet-700 hover:bg-violet-50" : "bg-violet-700 text-white hover:bg-violet-800 disabled:opacity-50"}`}>
                    {permanent ? "Always included" : saving ? "Saving…" : enabled ? "Remove from dashboard" : "Add to dashboard"}
                  </button>
                </article>
              );
            })}
          </div>
          <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">Removing a shortcut only hides its dashboard card. It never deletes invoices, customers, expenses, stock or other saved records. Stock and Team Members can be added by Freelancer workspaces too.</p>
          {error && <p role="alert" className="mt-3 break-words rounded-xl bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}
        </div>
        <footer className="shrink-0 border-t border-slate-100 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
          <div className="flex justify-end"><button type="button" onClick={onClose} className="min-h-10 rounded-xl bg-violet-700 px-5 text-sm font-bold text-white hover:bg-violet-800">Done</button></div>
        </footer>
      </section>
    </div>
  );
}
