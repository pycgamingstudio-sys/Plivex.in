import { Link } from "react-router-dom";
import { ArrowLeft, ShieldCheck } from "lucide-react";

export default function LegalLayout({ title, updated, intro, children }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-10 border-b border-[#E5E7EB] bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#6D28D9] text-[13px] font-bold text-white">P</div>
            <p className="text-[15px] font-bold tracking-[-0.04em]">Pli<span className="text-[#6D28D9]">vex</span></p>
          </Link>
          <Link to="/" className="flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] px-3 py-1.5 text-[12px] font-semibold text-slate-600 hover:bg-slate-50"><ArrowLeft className="h-4 w-4" />Back to app</Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#6D28D9]/10 text-[#6D28D9]"><ShieldCheck className="h-5 w-5" /></span>
          <div>
            <h1 className="text-[22px] font-bold tracking-[-0.03em]">{title}</h1>
            {updated && <p className="text-[11px] text-slate-400">Last updated: {updated}</p>}
          </div>
        </div>
        <div className="mt-6 space-y-4 rounded-2xl border border-[#E5E7EB] bg-white p-6 text-[13px] leading-relaxed text-slate-600 shadow-sm">
          {intro && <p className="text-slate-700">{intro}</p>}
          <ul className="space-y-3">{children}</ul>
        </div>
        <p className="mt-6 text-center text-[11px] text-slate-400">Plivex · Made in India 🇮🇳</p>
      </main>
    </div>
  );
}

export function LegalItem({ title, children }) {
  return (
    <li className="rounded-lg bg-slate-50 p-3">
      <p className="font-bold text-slate-800">{title}</p>
      <p className="mt-1 text-slate-600">{children}</p>
    </li>
  );
}