import { useState, useMemo } from "react";
import { Receipt, Download } from "lucide-react";
import PageShell from "@/components/PageShell";
import { KEYS, loadList, loadState } from "@/lib/stores";
import { downloadGSTR1Json } from "@/lib/gstrExport";
import { inputCls } from "@/lib/ui";

const money = (v) => `₹ ${(Number(v) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PERIODS = [{ id: "month", label: "This month" }, { id: "last", label: "Last month" }, { id: "all", label: "All time" }];

function Card({ label, value, accent }) {
  return <div className={`rounded-xl border bg-card p-4 ${accent ? "border-accent/40 bg-accent/10" : ""}`}><p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-1 text-[20px] font-bold">{value}</p></div>;
}

export default function TaxSummary() {
  const [items] = useState(() => loadList(KEYS.history));
  const [period, setPeriod] = useState("month");
  const [gstin, setGstin] = useState(() => loadState(KEYS.businessProfile, {}).gstin || "");
  const now = new Date();
  const defaultFP = `${String(now.getMonth() + 1).padStart(2, "0")}${now.getFullYear()}`;
  const [fp, setFp] = useState(defaultFP);
  const filtered = useMemo(() => {
    const now = new Date();
    const cur = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return items.filter((it) => {
      const d = new Date(it.createdDate || it.issueDate);
      if (period === "all") return true;
      if (period === "month") return d >= cur;
      if (period === "last") return d >= last && d < cur;
      return true;
    });
  }, [items, period]);
  const cgst = filtered.reduce((s, it) => s + Number(it.cgst || 0), 0);
  const sgst = filtered.reduce((s, it) => s + Number(it.sgst || 0), 0);
  const igst = filtered.reduce((s, it) => s + Number(it.igst || 0), 0);
  const totalTax = cgst + sgst + igst;

  return (
    <PageShell icon={Receipt} title="Tax summary" subtitle="Breakdown of CGST, SGST and IGST collected.">
      <div className="flex gap-1.5 rounded-lg border bg-card p-1">
        {PERIODS.map((p) => <button key={p.id} onClick={() => setPeriod(p.id)} className={`flex-1 rounded-md py-2 text-[11px] font-bold transition-colors ${period === p.id ? "bg-secondary text-primary" : "text-muted-foreground"}`}>{p.label}</button>)}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Card label="CGST collected" value={money(cgst)} />
        <Card label="SGST collected" value={money(sgst)} />
        <Card label="IGST collected" value={money(igst)} accent />
      </div>
      <div className="rounded-xl border bg-card p-5">
        <div className="flex items-center justify-between"><p className="text-[13px] font-bold">Total tax</p><p className="text-[22px] font-bold tracking-[-0.03em] text-primary">{money(totalTax)}</p></div>
        <p className="mt-1 text-[11px] text-muted-foreground">{filtered.length} invoice(s) in this period.</p>
      </div>

      <div className="rounded-xl border bg-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Download className="h-4 w-4 text-primary" />
          <h3 className="text-[13px] font-bold">Export GSTR-1 Return (Government JSON)</h3>
        </div>
        <p className="text-[11px] text-muted-foreground mb-4">Generate official GSTR-1 JSON for the Government Offline Tool — no third-party fees.</p>
        <div className="grid gap-3 sm:grid-cols-2 mb-4">
          <label className="block text-[12px] font-semibold text-muted-foreground">Your GSTIN<input className={inputCls} value={gstin} onChange={(e) => setGstin(e.target.value)} placeholder="07AAAAA0000A1Z5" /></label>
          <label className="block text-[12px] font-semibold text-muted-foreground">Filing Period (MMYYYY)<input className={inputCls} value={fp} onChange={(e) => setFp(e.target.value)} placeholder="092026" maxLength={6} /></label>
        </div>
        <button onClick={() => downloadGSTR1Json(gstin, fp)} disabled={!gstin || fp.length !== 6} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-[12px] font-bold text-primary-foreground disabled:opacity-50 hover:opacity-90">
          <Download className="h-3.5 w-3.5" />Export GSTR-1 JSON
        </button>
      </div>
    </PageShell>
  );
}