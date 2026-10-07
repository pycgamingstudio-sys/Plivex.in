import { Phone, Mail, LifeBuoy, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

export default function ContactUs() {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <Link to="/" className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-500 hover:text-[#6D28D9]"><ArrowLeft className="h-3.5 w-3.5" />Back to Plivex</Link>
        <div className="mt-4 rounded-2xl border border-[#E5E7EB] bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#6D28D9]/10 text-[#6D28D9]"><LifeBuoy className="h-5 w-5" /></span>
            <div>
              <h1 className="text-[20px] font-bold tracking-[-0.03em] text-slate-900">Contact Plivex Support</h1>
              <p className="text-[12px] text-slate-500">We usually reply within a few hours.</p>
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <a href="tel:+919758455218" className="flex items-center gap-3 rounded-xl border border-[#E5E7EB] p-4 hover:bg-slate-50">
              <Phone className="h-5 w-5 text-emerald-600" />
              <div><p className="text-[13px] font-bold text-slate-800">+91 97584 55218</p><p className="text-[11px] text-slate-400">Phone support · Mon–Sat</p></div>
            </a>
            <a href="mailto:plivex.helps@gmail.com" className="flex items-center gap-3 rounded-xl border border-[#E5E7EB] p-4 hover:bg-slate-50">
              <Mail className="h-5 w-5 text-[#6D28D9]" />
              <div><p className="text-[13px] font-bold text-slate-800">plivex.helps@gmail.com</p><p className="text-[11px] text-slate-400">Email support · 24/7</p></div>
            </a>
          </div>
          <p className="mt-5 text-[11px] text-slate-400">Support hours: Monday–Saturday, 10:00–19:00 IST.</p>
        </div>
      </div>
    </div>
  );
}