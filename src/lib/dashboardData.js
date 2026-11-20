import { formatMoney } from "@/lib/currency";

export const money2 = (v, c = "INR", locale) => formatMoney(Number(v) || 0, c, locale);
export const dateLabel = (v) => (v ? new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");

export const btnAccent = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#6D28D9] px-4 py-2.5 text-[12px] font-bold text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-[#5B21B6] hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6D28D9] disabled:pointer-events-none disabled:opacity-60";
export const subPill = (cur, key) => `min-h-10 flex-1 rounded-lg px-2 py-2 text-[12px] font-bold transition-colors ${cur === key ? "bg-[#6D28D9] text-white shadow-sm" : "text-slate-500 hover:bg-slate-100"}`;
export const statusBadge = (s) => `rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${["Paid", "Sent", "Won"].includes(s) ? "bg-emerald-100 text-emerald-700" : ["Pending", "Negotiation", "Draft"].includes(s) ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`;
export { Empty } from "@/components/dashboard/Empty";

// Demo data is no longer seeded: every workspace starts empty and real data lives on the server.
export function seedDashboard() { /* intentionally empty */ }

export function exportCsv(filename, rows) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}