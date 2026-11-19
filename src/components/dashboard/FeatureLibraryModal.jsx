import { X } from "lucide-react";
import { getAvailableWorkspaceFeatureCatalog } from "@/lib/workspaceFeatures";
import { APP_EDITION } from "@/api/backendClient";

export default function FeatureLibraryModal({ features, updateFeatures, saving, error, onClose }) {
  const toggle = async (id) => {
    const next = features.includes(id) ? features.filter((item) => item !== id) : [...features, id];
    await updateFeatures(next);
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center overflow-y-auto bg-slate-950/40 p-2 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="feature-library-title" className="my-2 max-h-[calc(100dvh-1rem)] w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl sm:my-0 sm:max-h-[min(88dvh,760px)] sm:max-w-2xl sm:rounded-3xl sm:p-7" onClick={(event) => event.stopPropagation()}>
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0"><p className="break-words text-[10px] font-bold uppercase tracking-[0.12em] text-violet-700">Your workspace · Feature library</p><h2 id="feature-library-title" className="mt-1 break-words text-lg font-bold leading-6 text-slate-900 sm:text-xl">Make Plivex work your way.</h2><p className="mt-1 text-xs leading-5 text-slate-500 sm:text-sm">Choose which optional tools appear in your dashboard and workspace navigation.</p></div>
          <button type="button" onClick={onClose} aria-label="Close feature library" className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {getAvailableWorkspaceFeatureCatalog(APP_EDITION).map((item) => {
            const enabled = features.includes(item.id);
            return <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4 transition-colors">
              <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-bold text-slate-900">{item.label}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{item.description}</p></div><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">{enabled ? "In your workspace" : "Available"}</span></div>
              <button type="button" disabled={saving} onClick={() => toggle(item.id)} className="mt-4 min-h-9 w-full rounded-xl bg-violet-700 px-3 text-xs font-bold text-white transition hover:bg-violet-800 disabled:opacity-50">{saving ? "Saving…" : enabled ? "Remove from dashboard" : "Add to workspace"}</button>
            </div>;
          })}
        </div>
        {getAvailableWorkspaceFeatureCatalog(APP_EDITION).every((item) => features.includes(item.id)) && <p className="mt-5 rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">All optional features are already part of your workspace.</p>}
        <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50/70 p-3 text-xs leading-5 text-emerald-900"><strong>Core tools stay available.</strong> Invoices, Quotations, Stock Inventory and Team Members are permanent workspace cards. Feature preferences only control shortcuts and navigation; they never delete business records.</div>
        {error && <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}
        <div className="mt-5 flex justify-end"><button type="button" onClick={onClose} className="min-h-10 rounded-xl bg-violet-700 px-5 text-sm font-bold text-white hover:bg-violet-800">Done</button></div>
      </section>
    </div>
  );
}
