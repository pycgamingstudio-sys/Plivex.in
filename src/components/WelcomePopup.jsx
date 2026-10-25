import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";

const SEEN_KEY = "invoicepulse:welcomeSeen";

export default function WelcomePopup() {

  const [open, setOpen] = useState(false);

  useEffect(() => {
    let seen = false;
    try { seen = localStorage.getItem(SEEN_KEY) === "1"; } catch { /* ignore */ }
    if (seen) return;
    const timer = window.setTimeout(() => setOpen(true), 12000);
    return () => window.clearTimeout(timer);
  }, []);

  const dismiss = () => {
    setOpen(false);
    try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* ignore */ }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/30 p-4 backdrop-blur-sm sm:items-center" onClick={dismiss}>
      <div className="w-full max-w-[420px] overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-2xl fade-up" onClick={(e) => e.stopPropagation()}>
        <div className="relative bg-gradient-to-br from-[#6D28D9] to-[#4c1d95] p-5 text-white">
          <button onClick={dismiss} className="absolute right-3 top-3 rounded-lg p-2 text-white/80 hover:bg-white/10" aria-label="Dismiss"><X className="h-4 w-4" /></button>
          <div className="flex items-center gap-2"><Sparkles className="h-4 w-4" /><span className="text-[10px] font-bold uppercase tracking-[0.18em]">Welcome to Plivex</span></div>
          <h3 className="mt-2 text-[19px] font-bold leading-tight">Start with the Free plan 👋</h3>
          <p className="mt-1.5 text-[12px] leading-relaxed text-white/85">Free plan, no card needed. Your invoices, clients and progress are saved to your account.</p>
        </div>
        <div className="p-5">
          <p className="text-[12px] leading-relaxed text-slate-500">Start with Free and upgrade whenever you need Pro features such as WhatsApp sharing, team access, lead pipeline, payment reminders, GSTR-1 export, custom logo, multi-currency and premium designs.</p>
          <button onClick={dismiss} className="mt-4 w-full rounded-xl bg-[#6D28D9] py-2.5 text-[13px] font-bold text-white hover:bg-[#7C3AED]">Let's go 🚀</button>
        </div>
      </div>
    </div>
  );
}