import { useState, useMemo } from "react";
import { BarChart3 } from "lucide-react";
import PageShell from "@/components/PageShell";
import { KEYS, loadList } from "@/lib/stores";
import { useAuth } from "@/lib/AuthContext";
import { getCountryExperience } from "@/global/countries/country-experience.js";
import { formatCurrency } from "@/global/localization/number-format.js";
import { formatWorkspaceDate } from "@/global/localization/date-format.js";



function Stat({ label, value, accent }) {
  return <div className={`rounded-xl border bg-card p-4 ${accent ? "border-primary/40 bg-primary/[.04]" : ""}`}><p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-1 text-[22px] font-bold tracking-[-0.03em]">{value}</p></div>;
}

export default function UsageReports() {
  const { user } = useAuth();
  const country = getCountryExperience(user?.country_code || "IN");
  const locale = user?.locale_code || country?.defaultLocale || "en-IN";
  const currency = user?.currency_code || country?.currencyCode || "INR";
  const timeZone = user?.time_zone || (country?.timeZonePolicy === "workspace-select" ? "UTC" : country?.timeZonePolicy || "UTC");
  const money = (value, code = currency) => formatCurrency(Number(value) || 0, { currencyCode: code, locale });
  const dateLabel = (value) => value ? formatWorkspaceDate(value, { locale, timeZone, options: { year: undefined } }) : "—";
  const [items] = useState(() => loadList(KEYS.history));
  const month = useMemo(() => { const now = new Date(); return { y: now.getFullYear(), m: now.getMonth() }; }, []);
  const thisMonth = items.filter((it) => { const d = new Date(it.createdDate || it.issueDate); return d.getFullYear() === month.y && d.getMonth() === month.m; });
  const total = thisMonth.reduce((s, it) => s + (Number(it.total) || 0), 0);
  const count = thisMonth.length;
  const avg = count ? total / count : 0;
  const monthName = new Date(Date.UTC(month.y, month.m, 1)).toLocaleDateString(locale, { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <PageShell icon={BarChart3} title="Usage reports" subtitle={`Billing summary for ${monthName}.`}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Invoices this month" value={count} />
        <Stat label="Total billed" value={money(total)} accent />
        <Stat label="Average invoice" value={money(avg)} />
      </div>
      <div className="rounded-xl border bg-card">
        <div className="border-b px-4 py-3 text-[12px] font-bold">Invoices — {monthName}</div>
        {thisMonth.length === 0 ? <p className="px-4 py-8 text-center text-[12px] text-muted-foreground">No invoices generated this month yet.</p> : (
          <div className="divide-y">
            {thisMonth.map((it) => (
              <div key={it.id} className="flex items-center justify-between px-4 py-3 text-[12px]">
                <div><p className="font-semibold">{it.clientName || "Client"}</p><p className="text-muted-foreground">{it.number || "INV-000"} · {dateLabel(it.createdDate || it.issueDate)}</p></div>
                <p className="font-bold">{money(it.total, it.currency)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}