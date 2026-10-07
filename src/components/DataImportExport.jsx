import { useState, useRef } from "react";
import { Upload, Download, FileUp, X, Check, ArrowRight } from "lucide-react";
import { KEYS, loadList, loadState, saveList, genId } from "@/lib/stores";
import { inputCls, btnGhost } from "@/lib/ui";
import { btnAccent } from "@/lib/dashboardData";

const TARGETS = {
  clients: { label: "Clients", key: KEYS.clients, fields: ["name", "company", "email", "phone", "gstin", "address"] },
  stock: { label: "Stock / Products", key: KEYS.stock, fields: ["name", "sku", "quantity", "unit", "price", "lowStock"] },
};

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { headers: [], rows: [] };
  const split = (line) => {
    const out = []; let cur = ""; let q = false;
    for (let i = 0; i < line.length; i++) { const ch = line[i]; if (ch === '"') { q = !q; } else if (ch === "," && !q) { out.push(cur); cur = ""; } else { cur += ch; } }
    out.push(cur); return out.map((s) => s.trim());
  };
  const headers = split(lines[0]);
  const rows = lines.slice(1).map(split);
  return { headers, rows };
}

export default function DataImportExport() {
  const [target, setTarget] = useState("clients");
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [fileName, setFileName] = useState("");
  const [done, setDone] = useState(null);
  const fileRef = useRef(null);

  const onFile = (file) => {
    setDone(null);
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      if (file.name.endsWith(".json")) {
        try {
          const arr = JSON.parse(text);
          if (Array.isArray(arr) && arr.length) {
            const hs = Object.keys(arr[0]);
            setHeaders(hs);
            setRows(arr.map((o) => hs.map((h) => String(o[h] ?? ""))));
            setMapping({});
            return;
          }
        } catch { /* fall through to CSV */ }
      }
      const { headers: hs, rows: rs } = parseCSV(text);
      setHeaders(hs);
      setRows(rs);
      setMapping({});
    };
    reader.readAsText(file);
  };

  const fields = TARGETS[target].fields;
  const autoMap = () => {
    const m = {};
    headers.forEach((h, i) => {
      const norm = h.toLowerCase().replace(/[^a-z]/g, "");
      const match = fields.find((f) => norm.includes(f.toLowerCase().replace(/[^a-z]/g, "")) || f.toLowerCase().includes(norm));
      if (match) m[i] = match;
    });
    setMapping(m);
  };

  const reset = () => { setHeaders([]); setRows([]); setMapping({}); setFileName(""); if (fileRef.current) fileRef.current.value = ""; };

  const doImport = () => {
    const cfg = TARGETS[target];
    const existing = loadList(cfg.key);
    const mapped = rows.map((r) => {
      const obj = {};
      Object.entries(mapping).forEach(([idx, field]) => { if (field) obj[field] = r[Number(idx)]; });
      if (target === "stock") { obj.quantity = Number(obj.quantity) || 0; obj.price = Number(obj.price) || 0; obj.lowStock = Number(obj.lowStock) || 5; }
      obj.id = genId(target.slice(0, 3));
      return obj;
    }).filter((o) => o.name || o.clientName || o.number);
    saveList(cfg.key, [...mapped, ...existing]);
    setDone(`${mapped.length} record${mapped.length !== 1 ? "s" : ""} imported into ${cfg.label}.`);
    reset();
  };

  const exportAll = () => {
    const payload = {};
    const objectKeys = [KEYS.businessProfile, KEYS.settings, KEYS.draft, KEYS.pendingClient];
    Object.entries(KEYS).forEach(([k, key]) => {
      payload[k] = objectKeys.includes(key) ? loadState(key, {}) : loadList(key, { includeCancelled: true });
    });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `invoicepulse-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 rounded-xl border bg-card p-5">
      <div className="flex items-center gap-2"><FileUp className="h-4 w-4 text-primary" /><h3 className="text-[14px] font-bold">Data Import / Export</h3></div>
      <p className="text-[12px] text-muted-foreground">Import clients or stock from CSV exported by Zoho, Refrens or Vyapar, or back up all your workspace data. Invoices are created from the invoice builder.</p>

      <div className="flex flex-wrap gap-2">
        <button onClick={exportAll} className={`flex items-center gap-1.5 ${btnGhost}`}><Download className="h-3.5 w-3.5" />Export all data (JSON)</button>
      </div>

      <div className="border-t pt-4">
        <label className="block text-[12px] font-semibold text-muted-foreground">Import target<select className={inputCls} value={target} onChange={(e) => { setTarget(e.target.value); setMapping({}); }}>
          {Object.entries(TARGETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select></label>
        <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed p-3 text-[12px] font-semibold text-muted-foreground hover:border-primary/50 hover:text-primary">
          <Upload className="h-4 w-4" />{fileName || "Choose CSV or JSON file"}
          <input ref={fileRef} type="file" accept=".csv,.json,text/csv,application/json" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
      </div>

      {headers.length > 0 && (
        <div className="space-y-3 rounded-lg border p-3">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-bold text-slate-700">Map columns <span className="font-normal text-slate-400">({rows.length} rows detected)</span></p>
            <button onClick={autoMap} className="text-[11px] font-semibold text-primary hover:underline">Auto-match</button>
          </div>
          <div className="max-h-52 space-y-2 overflow-y-auto">
            {headers.map((h, i) => (
              <div key={i} className="flex items-center gap-2 text-[12px]">
                <span className="flex-1 truncate text-slate-600">{h}</span>
                <ArrowRight className="h-3 w-3 text-slate-300" />
                <select className={`${inputCls} w-auto`} value={mapping[i] || ""} onChange={(e) => setMapping((m) => ({ ...m, [i]: e.target.value || undefined }))}>
                  <option value="">— skip —</option>
                  {fields.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <button onClick={reset} className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 hover:text-slate-700"><X className="h-3.5 w-3.5" />Cancel</button>
            <button onClick={doImport} className={`flex items-center gap-1.5 ${btnAccent}`}><Check className="h-3.5 w-3.5" />Import {rows.length} rows</button>
          </div>
        </div>
      )}

      {done && <p className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600"><Check className="h-3.5 w-3.5" />{done}</p>}
    </div>
  );
}