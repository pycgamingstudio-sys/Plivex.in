import { Crown, PiggyBank, UsersRound } from "lucide-react";
import { KEYS, loadList } from "@/lib/stores";
import { money2 } from "@/lib/dashboardData";
import useWorkspaceTeam from "@/components/team/useWorkspaceTeam";

const statBlock = (label, value, tone) => (
  <div className="rounded-xl bg-slate-50 px-3 py-2.5">
    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
    <p className={`mt-1 text-[15px] font-bold ${tone || "text-slate-900"}`}>{value}</p>
  </div>
);

export default function OwnerMasterControl() {
  const invoices = loadList(KEYS.history);
  const expenses = loadList(KEYS.expenses);
  const quotations = loadList(KEYS.quotations);
  const { data: team, error: teamError } = useWorkspaceTeam();
  // The team breakdown only exists once the workspace has at least one teammate.
  const hasTeammates = Number(team?.teammateCount) > 0;
  const paidInvoices = invoices.filter((i) => i.status === "Paid");
  const paidRevenue = paidInvoices.reduce((s, i) => s + (Number(i.total) || 0), 0);
  const pendingInvoices = invoices.filter((i) => i.status !== "Paid");
  const pendingTotal = pendingInvoices.reduce((s, i) => s + (Number(i.total) || 0), 0);
  const totalSales = paidRevenue + pendingTotal;
  const totalExpenses = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const paidExpenses = expenses.filter((e) => e.status === "Paid").reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const netProfit = paidRevenue - totalExpenses;
  const netCashflow = paidRevenue - paidExpenses;

  return (
    <div className="space-y-3 fade-up">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#6D28D9] to-[#7C3AED] text-white shadow-sm"><Crown className="h-4 w-4" /></span>
        <div>
          <h2 className="text-[15px] font-bold text-slate-900">Owner Master Control</h2>
          <p className="text-[11px] text-slate-400">Live business command center — exclusive to the Business Owner.</p>
        </div>
      </div>
      <div className={`grid gap-4 ${hasTeammates ? "lg:grid-cols-2" : ""}`}>
        <div className="flex flex-col overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-sm transition-transform hover:-translate-y-0.5">
          <div className="relative flex h-28 items-center justify-center bg-gradient-to-br from-[#6D28D9] to-[#7C3AED]">
            <div className="text-center text-white">
              <PiggyBank className="mx-auto h-7 w-7 opacity-90" />
              <p className="mt-1 text-[14px] font-bold">Business Profitability &amp; Net Cashflow</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 p-4">
            {statBlock("Net Profit", money2(netProfit), netProfit >= 0 ? "text-emerald-600" : "text-rose-600")}
            {statBlock("Net Cashflow", money2(netCashflow), netCashflow >= 0 ? "text-emerald-600" : "text-rose-600")}
            {statBlock("Paid Revenue", money2(paidRevenue), "text-[#6D28D9]")}
            {statBlock("Total Expenses", money2(totalExpenses))}
          </div>
        </div>
        {hasTeammates && <div className="flex flex-col overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-sm transition-transform hover:-translate-y-0.5">
          <div className="relative flex h-28 items-center justify-center bg-gradient-to-br from-[#059669] to-[#10B981]">
            <div className="text-center text-white">
              <UsersRound className="mx-auto h-7 w-7 opacity-90" />
              <p className="mt-1 text-[14px] font-bold">Overall Team &amp; Sales Breakdown</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 p-4">
            {statBlock("Total Sales", money2(totalSales), "text-[#6D28D9]")}
            {statBlock("Pending Collection", money2(pendingTotal), "text-amber-600")}
            {statBlock("Open Quotations", String(quotations.length))}
            {statBlock("Team Members", teamError ? `Unavailable (${teamError.operation === 'response validation' ? 'response format' : teamError.status ? `HTTP ${teamError.status}` : 'network error'})` : team ? String(team.totalMembers) : "Loading…")}
          </div>
        </div>}
      </div>
    </div>
  );
}