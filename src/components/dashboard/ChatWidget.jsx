import { useState } from "react";
import { MessageCircle, X, Phone, Mail } from "lucide-react";

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen((o) => !o)} className="fixed bottom-20 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-[#6D28D9] text-white shadow-lg transition-transform hover:scale-105 md:bottom-6 md:right-6" aria-label="Support chat">
        {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
      </button>
      {open && (
        <div className="fixed bottom-36 right-4 z-40 w-[290px] overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-xl md:bottom-20 md:right-6">
          <div className="flex items-center gap-2 bg-[#6D28D9] p-3 text-white"><MessageCircle className="h-4 w-4" /><div><p className="text-[12px] font-bold">24/7 Support Assistant</p><p className="text-[10px] text-white/70">We typically reply in minutes</p></div></div>
          <div className="space-y-2 p-3">
            <div className="rounded-xl bg-slate-100 p-2.5 text-[11px] text-slate-600">Hi! 👋 How can we help you today? Tap a contact below or browse the Help Center.</div>
            <a href="tel:+919758455218" className="flex items-center gap-2 rounded-xl border border-[#E5E7EB] p-2.5 text-[11px] hover:bg-slate-50"><Phone className="h-3.5 w-3.5 text-emerald-600" />Call +91 97584 55218</a>
            <a href="mailto:plivex.helps@gmail.com" className="flex items-center gap-2 rounded-xl border border-[#E5E7EB] p-2.5 text-[11px] hover:bg-slate-50"><Mail className="h-3.5 w-3.5 text-[#6D28D9]" />plivex.helps@gmail.com</a>
          </div>
        </div>
      )}
    </>
  );
}