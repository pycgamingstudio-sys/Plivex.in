import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, CheckCircle2, Clock3, Home, X, XCircle } from "lucide-react";

const safeNextPath = (value) => {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\\\")) return "/dashboard";
  return value.split("?")[0].split("#")[0] || "/dashboard";
};

const money = (value) => {
  const paise = Number(value);
  if (!Number.isFinite(paise) || paise <= 0) return null;
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(paise / 100);
};

export default function PaymentResult() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const status = params.get("payment") || "pending";
  const nextPath = useMemo(() => safeNextPath(params.get("next")), [params]);
  const [seconds, setSeconds] = useState(5);
  const amount = money(params.get("amount"));
  const txnid = params.get("txnid");
  const plan = params.get("plan");

  useEffect(() => {
    if (status !== "success" && status !== "failed" && status !== "pending") return;
    const startedAt = Date.now();
    const tick = () => {
      const remaining = Math.max(0, 5 - Math.floor((Date.now() - startedAt) / 1000));
      setSeconds(remaining);
      if (remaining === 0) navigate(nextPath, { replace: true });
    };
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [status, nextPath, navigate]);

  const isSuccess = status === "success";
  const isFailed = status === "failed";
  const title = isSuccess ? "Payment successful!" : isFailed ? "Payment not completed" : "Payment is being verified";
  const description = isSuccess
    ? "Thank you! Your Plivex plan has been activated. You’re all set."
    : isFailed
      ? "We couldn’t confirm this payment. No plan has been activated from this attempt."
      : "Your payment status is not final yet. Please check your Plivex account before trying again.";

  const goNow = () => navigate(isFailed ? "/pricing" : nextPath, { replace: true });

  return (
    <main className="min-h-[100dvh] bg-[#F8F7FC] px-4 py-8 text-[#171717] sm:grid sm:place-items-center">
      <section className="relative mx-auto flex min-h-[min(680px,calc(100dvh-4rem))] w-full max-w-md flex-col items-center justify-center rounded-[28px] border border-violet-100 bg-white px-6 py-10 text-center shadow-[0_20px_70px_rgba(91,33,182,0.10)] sm:min-h-[620px] sm:px-9">
        <button type="button" onClick={goNow} aria-label="Close payment result and return to Plivex" className="absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-900">
          <X className="h-5 w-5" />
        </button>

        <div className={`mb-6 grid h-24 w-24 place-items-center rounded-full ${isSuccess ? "bg-emerald-50 text-emerald-600" : isFailed ? "bg-rose-50 text-rose-600" : "bg-amber-50 text-amber-600"}`}>
          {isSuccess ? <CheckCircle2 className="h-14 w-14" strokeWidth={1.8} /> : isFailed ? <XCircle className="h-14 w-14" strokeWidth={1.8} /> : <Clock3 className="h-14 w-14" strokeWidth={1.8} />}
        </div>

        <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-violet-700">PLIVEX PAYMENTS</p>
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-[34px]">{title}</h1>
        <p className="mt-3 max-w-sm text-sm leading-6 text-slate-500">{description}</p>

        {(amount || plan || txnid) && (
          <div className="mt-8 w-full rounded-2xl border border-slate-100 bg-slate-50 p-4 text-left">
            {amount && <div className="mb-3 flex items-center justify-between gap-3"><span className="text-sm text-slate-500">Amount</span><strong className="text-lg font-extrabold">{amount}</strong></div>}
            {plan && <div className="mb-3 flex items-center justify-between gap-3"><span className="text-sm text-slate-500">Plan</span><strong className="text-sm">{plan}</strong></div>}
            {txnid && <div className="border-t border-slate-200 pt-3"><p className="text-xs text-slate-500">Transaction ID</p><p className="mt-1 break-all font-mono text-xs font-semibold text-slate-700">{txnid}</p></div>}
          </div>
        )}

        {isSuccess && <p className="mt-5 text-xs font-medium text-emerald-700">Your subscription status has been verified by Plivex.</p>}
        {isFailed && <Link to="/pricing" className="mt-5 text-sm font-semibold text-violet-700 underline underline-offset-4">View plans and try again</Link>}
        {status === "pending" && <p className="mt-5 text-xs text-amber-700">Please don’t make another payment until the status is clear.</p>}

        <div className="mt-9 w-full">
          <button type="button" onClick={goNow} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#6D28D9] px-5 py-3 text-sm font-bold text-white shadow-lg shadow-violet-200 transition hover:bg-[#5B21B6]">
            {isFailed ? "Return to Plivex" : "Continue to Plivex"} <ArrowRight className="h-4 w-4" />
          </button>
          <div className="mt-4 flex items-center justify-center gap-2 text-xs text-slate-400">
            <Home className="h-3.5 w-3.5" /> Returning automatically in {seconds}s
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-violet-100">
            <div className="h-full rounded-full bg-violet-600 transition-[width] duration-300" style={{ width: `${((5 - seconds) / 5) * 100}%` }} />
          </div>
        </div>
        <p className="mt-8 text-[11px] text-slate-400">Secure payment experience by Plivex</p>
      </section>
    </main>
  );
}
