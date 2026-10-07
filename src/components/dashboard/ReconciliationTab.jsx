import { useState } from "react";
import { Upload, CheckCircle2, XCircle, BarChart3, FileText, AlertTriangle } from "lucide-react";
import { parseCSVStatement, reconcileTransactions } from "@/lib/reconciliation";
import { money2 } from "@/lib/dashboardData";

export default function ReconciliationTab() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(""); setResult(null); setLoading(true);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const transactions = parseCSVStatement(ev.target.result);
        if (!transactions.length) { setError("No credit transactions found in file. Ensure columns include Date, Narration, and Credit Amount."); setLoading(false); return; }
        const res = reconcileTransactions(transactions);
        setResult(res);
      } catch (err) {
        setError("Failed to parse file. Please upload a valid CSV bank statement.");
      }
      setLoading(false);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-[#E5E7EB] bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#6D28D9]/10 text-[#6D28D9]"><BarChart3 className="h-5 w-5" /></div>
          <div>
            <h3 className="text-[15px] font-bold text-slate-900">Payment Reconciliation Engine</h3>
            <p className="text-[12px] text-slate-500">Upload a CSV bank statement to auto-match transactions with pending invoices</p>
          </div>
        </div>
        <label className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-[#6D28D9]/30 bg-[#6D28D9]/5 p-8 cursor-pointer hover:bg-[#6D28D9]/10 transition-colors">
          <Upload className="h-8 w-8 text-[#6D28D9]" />
          <div className="text-center">
            <p className="text-[13px] font-bold text-slate-700">Upload CSV Bank Statement</p>
            <p className="text-[11px] text-slate-400 mt-1">Columns needed: Date, Narration/Description, Credit Amount, UTR/Reference</p>
          </div>
          <span className="rounded-xl bg-[#6D28D9] px-4 py-2 text-[12px] font-bold text-white">Choose File</span>
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
        </label>
        {loading && <p className="mt-4 text-center text-[12px] font-semibold text-slate-500 animate-pulse">Processing transactions…</p>}
        {error && <div className="mt-4 flex items-center gap-2 rounded-xl bg-rose-50 px-4 py-3 text-[12px] font-semibold text-rose-700"><AlertTriangle className="h-4 w-4" />{error}</div>}
      </div>

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-center">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 mx-auto mb-1" />
              <p className="text-[22px] font-bold text-emerald-700">{result.matched}</p>
              <p className="text-[11px] font-semibold text-emerald-600">Auto-Matched</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center">
              <XCircle className="h-5 w-5 text-slate-400 mx-auto mb-1" />
              <p className="text-[22px] font-bold text-slate-600">{result.unmatched}</p>
              <p className="text-[11px] font-semibold text-slate-500">Unmatched</p>
            </div>
            <div className="rounded-2xl border border-[#6D28D9]/20 bg-[#6D28D9]/5 p-4 text-center">
              <BarChart3 className="h-5 w-5 text-[#6D28D9] mx-auto mb-1" />
              <p className="text-[14px] font-bold text-[#6D28D9]">{money2(result.totalReconciled)}</p>
              <p className="text-[11px] font-semibold text-[#6D28D9]">Reconciled</p>
            </div>
          </div>

          <div className="rounded-2xl border border-[#E5E7EB] bg-white shadow-sm overflow-hidden">
            <div className="border-b border-[#E5E7EB] px-4 py-3 text-[12px] font-bold text-slate-900">Transaction Results</div>
            <div className="divide-y divide-[#E5E7EB]">
              {result.entries.map((tx, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-[12px] font-semibold text-slate-900 truncate max-w-[200px]">{tx.narration || "—"}</p>
                    <p className="text-[10px] text-slate-400">{tx.utr ? `UTR: ${tx.utr}` : "No UTR"} · {tx.date || "—"}</p>
                  </div>
                  <div className="flex items-center gap-2 text-right">
                    <p className="text-[12px] font-bold text-slate-900">{money2(tx.amount)}</p>
                    <span className={`rounded-full px-2.5 py-1 text-[9px] font-bold uppercase ${tx.matchStatus === "AUTOMATCHED" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{tx.matchStatus}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}