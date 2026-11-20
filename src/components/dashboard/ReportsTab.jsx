import { useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { Download, TrendingUp, Clock, Wallet, PiggyBank, LockKeyhole } from "lucide-react";
import { KEYS, loadList } from "@/lib/stores";
import { money2, exportCsv } from "@/lib/dashboardData";
import { usePaywall } from "@/lib/paywall";

const tone = { emerald: "bg-emerald-100 text-emerald-600", amber: "bg-amber-100 text-amber-600", rose: "bg-rose-100 text-rose-600", violet: "bg-violet-100 text-violet-600" };
const validCurrency = (value) => /^[A-Z]{3}$/.test(String(value || "").trim().toUpperCase());

const groupedTotals = (records, amountKey, currencyKey) => {
  const totals = new Map();
  let unknownCurrencyCount = 0;
  records.forEach((record) => {
    const currency = String(record?.[currencyKey] || "").trim().toUpperCase();
    const amount = Number(record?.[amountKey]);
    if (!validCurrency(currency)) { unknownCurrencyCount += 1; return; }
    if (!Number.isFinite(amount)) return;
    totals.set(currency, (totals.get(currency) || 0) + amount);
  });
  return { totals, unknownCurrencyCount };
};
const displayTotals = ({ totals, unknownCurrencyCount }, preferredCurrency) => {
  const values = [...totals.entries()]
    .sort(([a], [b]) => a === preferredCurrency ? -1 : b === preferredCurrency ? 1 : a.localeCompare(b))
    .map(([currency, amount]) => money2(amount, currency));
  if (unknownCurrencyCount) values.push(`Currency not recorded (${unknownCurrencyCount})`);
  return values.join(" · ") || money2(0, preferredCurrency);
};

export default function ReportsTab() {
  const { user } = useAuth();
  const currencyCode = user?.currency_code || "INR";
  const { canAccess, openPaywall } = usePaywall();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const invoices = loadList(KEYS.history);
  const expenses = loadList(KEYS.expenses);
  const paylog = loadList(KEYS.paymentLogs);
  const paidNos = new Set(paylog.filter((entry) => String(entry.status || "").toLowerCase() === "paid").map((entry) => entry.invoiceNumber));
  const inRange = (record, key) => {
    const raw = String(record?.[key] || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return !from && !to;
    return (!from || raw >= from) && (!to || raw <= to);
  };
  const filteredInvoices = invoices.filter((item) => inRange(item, "issueDate"));
  const filteredExpenses = expenses.filter((item) => inRange(item, "date"));
  const statusOf = (item) => item.status === "Paid" || paidNos.has(item.number) ? "Paid" : "Pending";
  const revenueByCurrency = groupedTotals(filteredInvoices, "total", "currency");
  const paidByCurrency = groupedTotals(filteredInvoices.filter((item) => statusOf(item) === "Paid"), "total", "currency");
  const pendingByCurrency = groupedTotals(filteredInvoices.filter((item) => statusOf(item) !== "Paid"), "total", "currency");
  const expensesByCurrency = groupedTotals(filteredExpenses, "amount", "currencyCode");
  const revenue = displayTotals(revenueByCurrency, currencyCode);
  const paid = displayTotals(paidByCurrency, currencyCode);
  const pending = displayTotals(pendingByCurrency, currencyCode);
  const totalExp = displayTotals(expensesByCurrency, currencyCode);
  const baseRevenue = revenueByCurrency.totals.get(currencyCode) || 0;
  const baseExpenses = expensesByCurrency.totals.get(currencyCode) || 0;
  const baseProfit = baseRevenue - baseExpenses;
  const hasMixedOrUnknownCurrency = new Set([
    ...revenueByCurrency.totals.keys(),
    ...expensesByCurrency.totals.keys(),
  ]).size > 1 || revenueByCurrency.unknownCurrencyCount > 0 || expensesByCurrency.unknownCurrencyCount > 0;

  const doExport = () => {
    const rows = [
      ...filteredInvoices.map((item) => ({ Type: "Sale", Date: item.issueDate || "", Party: item.clientName || "", Amount: item.total || 0, Currency: item.currency || "Not recorded", Status: statusOf(item) })),
      ...filteredExpenses.map((item) => ({ Type: "Expense", Date: item.date || "", Party: item.vendor || "", Amount: item.amount || 0, Currency: item.currencyCode || "Not recorded", Status: item.status || "" })),
    ];
    exportCsv("plivex-business-report.csv", rows);
  };

  const cards = [
    { label: "Sales Revenue", value: revenue, icon: TrendingUp, tone: "emerald" },
    { label: "Paid / Collected", value: paid, icon: Clock, tone: "amber" },
    { label: "Expenses", value: totalExp, icon: Wallet, tone: "rose" },
    { label: "Operating Difference · " + currencyCode, value: money2(baseProfit, currencyCode), icon: PiggyBank, tone: "violet" },
  ];

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-end gap-3 rounded-2xl border border-[#E8E7EF] bg-white p-4 shadow-[0_1px_2px_rgba(24,24,40,.03),0_8px_24px_rgba(24,24,40,.035)]" aria-label="Report date range">
        <div className="mr-auto"><h3 className="text-[14px] font-bold text-slate-900">Report period</h3><p className="text-[11px] text-slate-500">Choose a date range for sales and expense records.</p></div>
        <label className="grid gap-1 text-[11px] font-semibold text-slate-600">From<input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} className="min-h-9 rounded-lg border border-slate-200 px-2.5 text-[12px]" /></label>
        <label className="grid gap-1 text-[11px] font-semibold text-slate-600">To<input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} className="min-h-9 rounded-lg border border-slate-200 px-2.5 text-[12px]" /></label>
        {(from || to) && <button type="button" onClick={() => { setFrom(""); setTo(""); }} className="min-h-9 rounded-lg border border-slate-200 px-3 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">Clear dates</button>}
      </section>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="min-w-0 rounded-2xl border border-[#E5E7EB] bg-white p-4 shadow-sm sm:p-5">
            <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${tone[card.tone]}`}><card.icon className="h-5 w-5" /></span>
            <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{card.label}</p>
            <p className="mt-1 break-words text-[18px] font-bold tracking-[-0.03em] text-slate-900 sm:text-[20px]">{card.value}</p>
          </div>
        ))}
      </div>
      <section className="rounded-2xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
        <h3 className="text-[14px] font-bold text-slate-900">Payment position</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-emerald-100 bg-gradient-to-br from-emerald-50/80 to-white p-3"><p className="text-[10px] font-semibold uppercase text-emerald-700">Paid / Collected</p><p className="mt-1 break-words text-[15px] font-bold text-emerald-950">{paid}</p></div><div className="rounded-xl border border-amber-100 bg-gradient-to-br from-amber-50/80 to-white p-3"><p className="text-[10px] font-semibold uppercase text-amber-700">Pending</p><p className="mt-1 break-words text-[15px] font-bold text-amber-950">{pending}</p></div></div>
        {hasMixedOrUnknownCurrency && <p className="mt-3 text-[11px] leading-relaxed text-slate-500">Totals are grouped by recorded currency. Operating difference uses only {currencyCode} records; other currencies are not converted. Some records have no valid recorded currency.</p>}
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">Operating difference is sales revenue minus recorded expenses. It is not a complete accounting profit figure and excludes taxes, cost of goods, and other adjustments not recorded here.</p>
      </section>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#E8E7EF] bg-white p-4 shadow-[0_1px_2px_rgba(24,24,40,.03),0_8px_24px_rgba(24,24,40,.035)] sm:p-5">
        <div><h3 className="text-[15px] font-bold text-slate-900">Export your books</h3><p className="text-[12px] text-slate-500">Download filtered sales and expense records, including currency.</p></div>
        <button type="button" onClick={canAccess("gstr1") ? doExport : openPaywall} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#6D28D9] px-4 py-2.5 text-[12px] font-bold text-white hover:bg-[#5B21B6]">{canAccess("gstr1") ? <><Download className="h-4 w-4" />Export CSV</> : <><LockKeyhole className="h-4 w-4" />Unlock GSTR-1 Export</>}</button>
      </div>
    </div>
  );
}
