const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const STATE_CODES = new Set(["01","02","03","04","05","06","07","08","09","10","11","12","13","14","15","16","17","18","19","20","21","22","23","24","25","26","27","28","29","30","31","32","33","34","35","36","37","38","97"]);
const round = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const validGSTIN = (value) => {
  const g = String(value || "").trim().toUpperCase();
  if (!GSTIN_RE.test(g) || !STATE_CODES.has(g.slice(0, 2))) return false;
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"; let factor = 2, sum = 0;
  for (let i = 13; i >= 0; i--) { let p = chars.indexOf(g[i]) * factor; p = Math.floor(p / 36) + (p % 36); sum += p; factor = factor === 2 ? 1 : 2; }
  return g[14] === chars[(36 - (sum % 36)) % 36];
};
const parsePeriod = (fp) => {
  if (!/^(0[1-9]|1[0-2])\\d{4}$/.test(fp)) throw new Error("Filing period must be MMYYYY.");
  return { month: Number(fp.slice(0, 2)), year: Number(fp.slice(2)) };
};
const dateInfo = (v) => { const d = new Date(v); return v && !Number.isNaN(d.getTime()) ? { d, text: [String(d.getDate()).padStart(2,"0"),String(d.getMonth()+1).padStart(2,"0"),d.getFullYear()].join("-") } : null; };
const stateFromAddress = (address) => {
  const text = String(address || "").toLowerCase();
  const states = [["andhra pradesh","37"],["arunachal pradesh","12"],["assam","18"],["bihar","10"],["chhattisgarh","22"],["goa","30"],["gujarat","24"],["haryana","06"],["himachal pradesh","02"],["jharkhand","20"],["karnataka","29"],["kerala","32"],["madhya pradesh","23"],["maharashtra","27"],["manipur","14"],["meghalaya","17"],["mizoram","15"],["nagaland","13"],["odisha","21"],["punjab","03"],["rajasthan","08"],["sikkim","11"],["tamil nadu","33"],["telangana","36"],["tripura","16"],["uttar pradesh","09"],["uttarakhand","05"],["west bengal","19"],["delhi","07"],["jammu and kashmir","01"],["ladakh","38"],["puducherry","34"],["chandigarh","04"]];
  return states.find(([n]) => text.includes(n))?.[1] || "";
};
const item = (t) => ({ num: 1, itm_det: { txval: t.taxable, rt: t.rate, iamt: t.igst, camt: t.cgst, samt: t.sgst, csamt: 0 } });

export function generateGSTR1(gstinInput, monthYear, invoices, clients = []) {
  const gstin = String(gstinInput || "").trim().toUpperCase();
  if (!validGSTIN(gstin)) throw new Error("Enter a valid GSTIN (15 characters, including a valid state code and checksum).");
  const { month, year } = parsePeriod(String(monthYear || ""));
  if (!Array.isArray(invoices)) throw new Error("Invoice data is unavailable. Refresh and try again.");
  const clientMap = new Map(clients.map(c => [String(c.name || c.company || "").trim().toLowerCase(), c]));
  const seen = new Set(), errors = [], b2b = new Map(), b2cl = new Map(), b2cs = new Map();
  const supplierState = gstin.slice(0, 2);
  for (const inv of invoices) {
    if (String(inv.status || "").toLowerCase() === "cancelled" || inv.is_draft || inv.isDraft) continue;
    const date = dateInfo(inv.issue_date || inv.issueDate);
    if (!date || date.d.getFullYear() !== year || date.d.getMonth() + 1 !== month) continue;
    const identity = String(inv.id || inv.number || "").trim();
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    const number = String(inv.number || "").trim();
    if (!number || number.length > 16) { errors.push(`Invoice ${number || identity}: invoice number missing or over 16 characters.`); continue; }
    const client = clientMap.get(String(inv.client_name || inv.clientName || "").trim().toLowerCase());
    const ctin = String(client?.gstin || inv.client_gstin || inv.clientGstin || "").trim().toUpperCase();
    if (ctin && !validGSTIN(ctin)) { errors.push(`Invoice ${number}: customer GSTIN is invalid.`); continue; }
    const pos = ctin ? ctin.slice(0, 2) : stateFromAddress(client?.address);
    if (!pos || !STATE_CODES.has(pos)) { errors.push(`Invoice ${number}: customer state/place of supply is missing; update customer address.`); continue; }
    const taxable = round(inv.subtotal), total = round(inv.total), cgst = round(inv.cgst), sgst = round(inv.sgst), igst = round(inv.igst);
    const tax = round(cgst + sgst + igst);
    if (![taxable,total,cgst,sgst,igst].every(Number.isFinite) || taxable < 0 || total <= 0 || Math.abs(round(taxable + tax) - total) > 1) { errors.push(`Invoice ${number}: invoice totals do not reconcile (subtotal + GST must match total).`); continue; }
    const rates = [...new Set((inv.invoice_items || inv.items || []).map(x => Number(x.gst_rate ?? x.gstRate)).filter(x => Number.isFinite(x) && x >= 0))];
    const rate = rates.length === 1 ? rates[0] : Number(inv.tax_rate ?? inv.taxRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) { errors.push(`Invoice ${number}: GST rate is missing or invalid.`); continue; }
    const interstate = pos !== supplierState;
    if ((interstate && (cgst > 0 || sgst > 0 || igst <= 0)) || (!interstate && (igst > 0 || (taxable > 0 && cgst + sgst <= 0)))) { errors.push(`Invoice ${number}: GST split conflicts with place of supply ${pos}.`); continue; }
    const details = item({ taxable, rate, cgst, sgst, igst });
    if (ctin) { if (!b2b.has(ctin)) b2b.set(ctin, []); b2b.get(ctin).push({ inum:number,idt:date.text,val:total,pos,rchrg:"N",inv_typ:"R",itms:[details] }); }
    else if (interstate && total > 100000) { if (!b2cl.has(pos)) b2cl.set(pos, []); b2cl.get(pos).push({ inum:number,idt:date.text,val:total,itms:[details] }); }
    else {
      const key = [interstate ? "INTER" : "INTRA",pos,rate].join("|");
      const row = b2cs.get(key) || { sply_ty:interstate ? "INTER" : "INTRA",pos,typ:"OE",rt:rate,txval:0,iamt:0,camt:0,samt:0,csamt:0 };
      row.txval=round(row.txval+taxable); row.iamt=round(row.iamt+igst); row.camt=round(row.camt+cgst); row.samt=round(row.samt+sgst); b2cs.set(key,row);
    }
  }
  if (errors.length) throw new Error("Export stopped. Fix these invoice issues first:\\n" + errors.slice(0,8).join("\\n") + (errors.length>8 ? `\\n…and ${errors.length-8} more.` : ""));
  return { gstin, fp:String(monthYear), version:"GST3.2.4", b2b:[...b2b].map(([ctin,inv])=>({ctin,inv})), b2cl:[...b2cl].map(([pos,inv])=>({pos,inv})), b2cs:[...b2cs.values()] };
}
export function downloadGSTR1Json(gstin, monthYear, invoices, clients) {
  const data = generateGSTR1(gstin, monthYear, invoices, clients);
  const blob = new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=`GSTR1_${String(gstin).toUpperCase()}_${monthYear}.json`;
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  return data;
}
