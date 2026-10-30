import { useState, useMemo } from "react";
import { Receipt, Download } from "lucide-react";
import PageShell from "@/components/PageShell";
import { KEYS, loadList, loadState } from "@/lib/stores";
import { backend } from "@/api/backendClient";
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
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const now = new Date();
  const [fp, setFp] = useState(`${String(now.getMonth() + 1).padStart(2, "0")}${now.getFullYear()}`);
  const filtered = useMemo(() => {
    const current = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const previous = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
    return items.filter((it) => {
      const d = new Date(it.issueDate || it.createdDate);
      if (period === "all") return true;
      if (period === "month") return d >= current;
      if (period === "last") return d >= previous && d < current;
      return true;
    });
  }, [items, period]);
  const cgst = filtered.reduce((s, it) => s + Number(it.cgst || 0), 0);
  const sgst = filtered.reduce((s, it) => s + Number(it.sgst || 0), 0);
  const igst = filtered.reduce((s, it) => s + Number(it.igst || 0), 0);
  const totalTax = cgst + sgst + igst;
  const exportReport = async () => {
    setExportError(""); setExporting(true);
    try {
      const [invoiceResult, clientResult, profileResult] = await Promise.all([
        backend.functions.invoke("listInvoices", { limit: 1000 }),
        backend.functions.invoke("workspaceRecords", { table: "clients", action: "list" }),
        backend.functions.invoke("workspaceRecords", { table: "business_profile", action: "get" }),
      ]);
      const invoices = invoiceResult?.data?.invoices;
      const clients = clientResult?.data?.records;
      const profile = profileResult?.data?.record;
      if (!Array.isArray(invoices) || !Array.isArray(clients)) throw new Error("Could not retrieve verified workspace records. Please refresh and try again.");
      const ownGstin = String(gstin || profile?.gstin || "").trim().toUpperCase();
      if (!gstin && ownGstin) setGstin(ownGstin);
      downloadGSTR1Json(ownGstin, fp, invoices, clients);
    } catch (error) {
      setExportError(error?.message || "GSTR-1 export failed. Please try again.");
    } finally { setExporting(false); }
  };

  return (
    <PageShell icon={Receipt} title="Tax summary" subtitle="Breakdown of CGST, SGST and IGST collected.">
      <div className="flex gap-1.5 rounded-lg border bg-card p-1">
        {PERIODS.map((p) => <button key={p.id} onClick={() => setPeriod(p.id)} className={`flex-1 rounded-md py-2 text-[11px] font-bold transition-colors ${period === p.id ? "bg-secondary text-primary" : "text-muted-foreground"}`}>{p.label}</button>)}
      </div>
      <div className="grid gap-3 sm:grid-cols-3"><Card label="CGST collected" value={money(cgst)} /><Card label="SGST collected" value={money(sgst)} /><Card label="IGST collected" value={money(igst)} accent /></div>
      <div className="rounded-xl border bg-card p-5">
        <div className="flex items-center justify-between"><p className="text-[13px] font-bold">Total tax</p><p className="text-[22px] font-bold tracking-[-0.03em] text-primary">{money(totalTax)}</p></div>
        <p className="mt-1 text-[11px] text-muted-foreground">{filtered.length} invoice(s) in this period.</p>
      </div>
      <div className="rounded-xl border bg-card p-5">
        <div className="mb-4 flex items-center gap-2"><Download className="h-4 w-4 text-primary" /><h3 className="text-[13px] font-bold">Export GSTR-1 Return (JSON)</h3></div>
        <p className="mb-4 text-[11px] text-muted-foreground">Uses the latest invoices, customers and business GSTIN fetched from your signed-in workspace. Draft and cancelled invoices are excluded.</p>
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-[12px] font-semibold text-muted-foreground">Your GSTIN<input className={inputCls} value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} placeholder="07AAAAA0000A1Z5" maxLength={15} /></label>
          <label className="block text-[12px] font-semibold text-muted-foreground">Filing Period (MMYYYY)<input className={inputCls} value={fp} onChange={(e) => setFp(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))} placeholder="102026" maxLength={6} inputMode="numeric" /></label>
        </div>
        {exportError && <p role="alert" className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-[12px] text-destructive whitespace-pre-wrap">{exportError}</p>}
        <button onClick={exportReport} disabled={exporting || !gstin || fp.length !== 6} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-[12px] font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50">
          <Download className="h-3.5 w-3.5" />{exporting ? "Preparing report…" : "Export GSTR-1 JSON"}
        </button>
      </div>
    </PageShell>
  );
}
