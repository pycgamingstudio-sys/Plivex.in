import { backend as db } from '@/api/backendClient';

import { Link } from "react-router-dom";
import { usePaywall } from "@/lib/paywall";
import { Lock, Sparkles, Check, X as XIcon, LogOut } from "lucide-react";

export default function SubscriptionLockScreen() {
  const { openPaywall, trialDaysLeft } = usePaywall();

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#F5F3FF] to-slate-50 p-4">
      <div className="w-full max-w-[520px] rounded-3xl border border-[#E5E7EB] bg-white p-6 text-center shadow-xl sm:p-8">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6D28D9] to-[#7C3AED] text-white"><Lock className="h-6 w-6" /></div>
        <h1 className="mt-4 text-[22px] font-bold text-slate-900">Your 14-day free trial has ended</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-slate-500">
          The workspace is locked to keep your data safe. Upgrade to instantly restore access to billing, inventory, GST reports and your team — all your data is exactly where you left it.
        </p>

        <button onClick={openPaywall} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#6D28D9] to-[#7C3AED] px-4 py-3 text-[13px] font-bold text-white transition-opacity hover:opacity-95">
          <Sparkles className="h-4 w-4" />Choose a plan &amp; unlock now
        </button>

        <div className="mt-5 grid gap-2 text-left sm:grid-cols-2">
          <div className="rounded-xl border border-[#E5E7EB] p-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Basic plan</p>
            <div className="mt-1.5 space-y-1 text-[11px] text-slate-600">
              <p className="flex items-center gap-1.5"><Check className="h-3 w-3 text-emerald-500" />Single-user billing</p>
              <p className="flex items-center gap-1.5"><Check className="h-3 w-3 text-emerald-500" />Basic stock &amp; client management</p>
              <p className="flex items-center gap-1.5"><XIcon className="h-3 w-3 text-rose-400" />No staff invites</p>
              <p className="flex items-center gap-1.5"><XIcon className="h-3 w-3 text-rose-400" />No GSTR-1/3B or Tally export</p>
            </div>
          </div>
          <div className="rounded-xl border border-[#6D28D9] bg-[#6D28D9]/5 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#6D28D9]">Premium plan</p>
            <div className="mt-1.5 space-y-1 text-[11px] text-slate-600">
              <p className="flex items-center gap-1.5"><Check className="h-3 w-3 text-emerald-500" />Advanced accounting &amp; multi-staff roles</p>
              <p className="flex items-center gap-1.5"><Check className="h-3 w-3 text-emerald-500" />Automated bulk imports</p>
              <p className="flex items-center gap-1.5"><Check className="h-3 w-3 text-emerald-500" />Full GST compliance (GSTR-1/3B, Tally)</p>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-[#E5E7EB] pt-4 text-[11px] font-medium text-slate-500">
          <Link to="/terms-and-conditions" className="hover:text-[#6D28D9]">Terms</Link>
          <Link to="/privacy-policy" className="hover:text-[#6D28D9]">Privacy</Link>
          <Link to="/refund-and-cancellation" className="hover:text-[#6D28D9]">Refund</Link>
          <Link to="/contact-us" className="hover:text-[#6D28D9]">Contact</Link>
          <button onClick={() => db.auth.logout()} className="inline-flex items-center gap-1 hover:text-[#6D28D9]"><LogOut className="h-3 w-3" />Sign out</button>
        </div>
      </div>
    </div>
  );
}