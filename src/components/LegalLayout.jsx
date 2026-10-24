import { Link } from "react-router-dom";
import { ArrowLeft, ShieldCheck } from "lucide-react";

export default function LegalLayout({ title, updated, intro, children }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-10 border-b border-[#E5E7EB] bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#6D28D9] text-[13px] font-bold text-white">P</div>
            <p className="text-[15px] font-bold tracking-[-0.04em]">Pli<span className="text-[#6D28D9]">vex</span></p>
          </Link>
          <Link to="/" className="flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] px-3 py-1.5 text-[12px] font-semibold text-slate-600 hover:bg-slate-50"><ArrowLeft className="h-4 w-4" />Back to app</Link>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8 sm:py-12">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#6D28D9]/10 text-[#6D28D9]"><ShieldCheck className="h-5 w-5" /></span>
          <div>
            <h1 className="text-2xl font-bold tracking-[-0.03em] sm:text-3xl">{title}</h1>
            {updated && <p className="mt-1 text-sm text-slate-500">Last updated: {updated}</p>}
          </div>
        </div>
        <div className="mt-6 space-y-5 rounded-2xl border border-[#E5E7EB] bg-white p-5 text-base leading-7 text-slate-700 shadow-sm sm:p-8">
          {intro && <p className="text-base font-medium leading-7 text-slate-800">{intro}</p>}
          <ul className="space-y-4">{children}</ul>
        </div>
        <p className="mt-6 text-center text-sm text-slate-500">Plivex · Made in India 🇮🇳</p>
      </main>
    </div>
  );
}

export function LegalItem({ title, children }) {
  return (
    <li className="rounded-xl border border-slate-100 bg-slate-50 p-4 sm:p-5">
      <p className="text-base font-bold text-slate-900">{title}</p>
      <p className="mt-2 text-base leading-7 text-slate-700">{children}</p>
    </li>
  );
}