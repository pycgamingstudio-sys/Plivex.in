import { KEYS, loadList } from "@/lib/stores";

/**
 * GSTR-1 Return File Generator (PDF Module 3)
 * Converts invoice records to official Government Offline Tool JSON schema
 */
export function generateGSTR1(gstin, monthYear) {
  // monthYear: "MMYYYY" e.g. "092026"
  const invoices = loadList(KEYS.history);
  const [mm, yyyy] = [monthYear.slice(0, 2), monthYear.slice(2)];
  const targetMonth = new Date(`${yyyy}-${mm}-01`);

  const filtered = invoices.filter((it) => {
    const d = new Date(it.issueDate || it.createdDate);
    return d.getFullYear() === targetMonth.getFullYear() && d.getMonth() === targetMonth.getMonth();
  });

  const b2b = [];
  const b2cs = [];

  filtered.forEach((inv) => {
    const val = Number(inv.total || 0);
    const txval = Number(inv.cgst || 0) + Number(inv.sgst || 0) + Number(inv.igst || 0);
    const taxableVal = Math.max(0, val - txval);
    const rt = Number(inv.taxRate || 18);
    const iamt = Number(inv.igst || 0);
    const camt = Number(inv.cgst || 0);
    const samt = Number(inv.sgst || 0);

    const idt = inv.issueDate
      ? inv.issueDate.split("-").reverse().join("-")
      : `01-${mm}-${yyyy}`;

    const item = {
      num: 1,
      itm_det: {
        txval: parseFloat(taxableVal.toFixed(2)),
        rt: parseFloat(rt.toFixed(2)),
        iamt: parseFloat(iamt.toFixed(2)),
        camt: parseFloat(camt.toFixed(2)),
        samt: parseFloat(samt.toFixed(2)),
      },
    };

    if (inv.clientGstin && inv.clientGstin.length === 15) {
      // B2B: registered taxpayer
      const existing = b2b.find((e) => e.ctin === inv.clientGstin);
      const invEntry = {
        inum: (inv.number || "INV-000").slice(0, 16),
        idt,
        val: parseFloat(val.toFixed(2)),
        pos: "27",
        rchrg: "N",
        inv_typ: "R",
        itms: [item],
      };
      if (existing) {
        existing.inv.push(invEntry);
      } else {
        b2b.push({ ctin: inv.clientGstin, inv: [invEntry] });
      }
    } else {
      // B2CS: unregistered consumer
      b2cs.push({
        sply_tp: "INTRA",
        rt: parseFloat(rt.toFixed(2)),
        typ: "OE",
        txval: parseFloat(taxableVal.toFixed(2)),
        iamt: 0,
        camt: parseFloat(camt.toFixed(2)),
        samt: parseFloat(samt.toFixed(2)),
      });
    }
  });

  return {
    gstin: (gstin || "").toUpperCase(),
    fp: monthYear,
    version: "GSTR1_v3.0",
    hash: `plivex-${Date.now()}`,
    b2b,
    b2cs,
  };
}

export function downloadGSTR1Json(gstin, monthYear) {
  const data = generateGSTR1(gstin, monthYear);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `GSTR1_${gstin || "GSTIN"}_${monthYear}.json`;
  a.click();
  URL.revokeObjectURL(url);
}