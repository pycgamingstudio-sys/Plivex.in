import { Download, TrendingUp, Clock, Wallet, PiggyBank, LockKeyhole } from "lucide-react";
import { KEYS, loadList } from "@/lib/stores";
import { money2, exportCsv } from "@/lib/dashboardData";
import { usePaywall } from "@/lib/paywall";

const tone = { emerald: "bg-emerald-100 text-emerald-600", amber: "bg-amber-100 text-amber-600", rose: "bg-rose-100 text-rose-600", violet: "bg-violet-100 text-violet-600" };

export default function ReportsTab() {
  const { canAccess, openPaywall } = usePaywall();
  const invoices = loadList(KEYS.history);
  const expenses = loadList(KEYS.expenses);
  const paylog = loadList(KEYS.paymentLogs);
  const paidNos = new Set(paylog.filter((l) => l.status === "paid").map((l) => l.invoiceNumber));
  const revenue = invoices.reduce((s, it) => s + Number(it.total || 0), 0);
  const pending = invoices.filter((it) => !paidNos.has(it.number)).reduce((s, it) => s + Number(it.total || 0), 0);
  const totalExp = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const net = revenue - totalExp;

  const doExport = () => {
    const rows = [
      ...invoices.map((it) => ({ Type: "Sale", Date: it.issueDate || "", Party: it.clientName || "", Amount: it.total || 0, Status: paidNos.has(it.number) ? "Paid" : "Pending" })),
      ...expenses.map((e) => ({ Type: "Expense", Date: e.date || "", Party: e.vendor || "", Amount: e.amount || 0, Status: e.status || "" })),
    ];
    exportCsv("invoicepulse-report.csv", rows);
  };

  const cards = [
    { label: "Total Revenue Generated", value: money2(revenue), icon: TrendingUp, tone: "emerald" },
    { label: "Pending Payments", value: money2(pending), icon: Clock, tone: "amber" },
    { label: "Total Expenses", value: money2(totalExp), icon: Wallet, tone: "rose" },
    { label: "Net Profit", value: money2(net), icon: PiggyBank, tone: "violet" },
  ];

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl border border-[#E5E7EB] bg-white p-5 shadow-sm">
            <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${tone[c.tone]}`}><c.icon className="h-5 w-5" /></span>
            <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{c.label}</p>
            <p className="mt-1 text-[22px] font-bold tracking-[-0.03em] text-slate-900">{c.value}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#E5E7EB] bg-white p-5 shadow-sm">
        <div><h3 className="text-[15px] font-bold text-slate-900">Export your books</h3><p className="text-[12px] text-slate-400">Download all sales and expense records as a CSV file.</p></div>
        <button onClick={canAccess("gstr1") ? doExport : openPaywall} className="inline-flex items-center gap-2 rounded-xl bg-[#6D28D9] px-4 py-2.5 text-[12px] font-bold text-white hover:bg-[#7C3AED]">{canAccess("gstr1") ? <><Download className="h-4 w-4" />Export CSV</> : <><LockKeyhole className="h-4 w-4" />Unlock GSTR-1 Export</>}</button>
      </div>
    </div>
  );
}