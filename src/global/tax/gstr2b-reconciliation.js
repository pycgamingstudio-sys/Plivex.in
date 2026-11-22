import { parseIndianGstin } from "./gstin.js";
const normalizeDate = (value) => {
  const raw=String(value||"").trim();
  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(raw)) return raw;
  const dmy=raw.match(/^(\\d{1,2})[\\/-](\\d{1,2})[\\/-](\\d{4})$/);
  if(dmy) return dmy[3]+"-"+dmy[2].padStart(2,"0")+"-"+dmy[1].padStart(2,"0");
  const named=raw.match(/^(\\d{1,2})[- ]([A-Za-z]{3,})[- ](\\d{4})$/);
  if(named){const month=new Date(named[2]+" 1, 2000").getMonth()+1;if(month>=1&&month<=12)return named[3]+"-"+String(month).padStart(2,"0")+"-"+named[1].padStart(2,"0");}
  return "";
};
const normalizeHeader = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const parseMoneyMinor = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const negative = /^\(.*\)$/.test(raw);
  const numeric = Number(raw.replace(/[(),₹$£€\s]/g, "").replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return 0;
  const minor = Math.round(Math.abs(numeric) * 100);
  return negative ? -minor : minor;
};
export function parseGstr2bCsv(csvText) {
  const source = String(csvText || "").replace(/^\uFEFF/, "");
  const grid = []; let row = [], field = "", quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '"') { if (quoted && source[i + 1] === '"') { field += '"'; i += 1; } else quoted = !quoted; }
    else if (ch === "," && !quoted) { row.push(field.trim()); field = ""; }
    else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && source[i + 1] === "\n") i += 1;
      row.push(field.trim()); field = ""; if (row.some((cell) => cell !== "")) grid.push(row); row = [];
    } else field += ch;
  }
  row.push(field.trim()); if (row.some((cell) => cell !== "")) grid.push(row);
  if (grid.length < 2) return [];
  const headers = grid[0].map(normalizeHeader);
  const find = (names) => headers.findIndex((header) => names.some((name) => header === name || header.includes(name)));
  const columns = {
    gstin:find(["gstinofsupplier","suppliergstin","gstin"]), supplier:find(["tradelegalname","suppliername","legalname","tradename"]),
    invoice:find(["invoicenumber","invoiceno","supplierinvoicenumber","documentnumber"]), date:find(["invoicedate","documentdate"]),
    invoiceValue:find(["invoicevalue","totalinvoicevalue"]), taxable:find(["taxablevalue"]), igst:find(["integratedtax","igst"]),
    cgst:find(["centraltax","cgst"]), sgst:find(["stateuttax","statetax","sgst"]), cess:find(["cess"]),
    itc:find(["itcavailable","itcavailability","eligibleitc"]), reason:find(["reason","remarks"]),
  };
  if ([columns.gstin,columns.invoice,columns.date,columns.taxable].some((index)=>index<0)) throw new Error("GSTR-2B CSV must include supplier GSTIN, invoice number, invoice date and taxable value columns.");
  const seen = new Set();
  return grid.slice(1).map((cells,index)=>{
    const supplierGstin=String(cells[columns.gstin]||"").trim().toUpperCase().replace(/\s+/g,"");
    if (!parseIndianGstin(supplierGstin).ok) return null;
    const invoiceNumber=String(cells[columns.invoice]||"").trim(), invoiceDate=normalizeDate(cells[columns.date]);
    if(!invoiceNumber||invoiceNumber.length>80||!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)) return null;
    const itcRaw=columns.itc>=0?String(cells[columns.itc]||"").trim().toLowerCase():"";
    const itcAvailable=/^(yes|y|eligible|available|true)$/.test(itcRaw)?true:/^(no|n|ineligible|not available|false)$/.test(itcRaw)?false:null;
    const key=[supplierGstin,invoiceNumber.toLowerCase(),invoiceDate].join("|"), duplicate=seen.has(key); seen.add(key);
    return {
      supplierGstin,supplierName:String(columns.supplier>=0?cells[columns.supplier]||"":"").trim(),invoiceNumber,invoiceDate,
      invoiceValueMinor:Math.max(0,parseMoneyMinor(columns.invoiceValue>=0?cells[columns.invoiceValue]:0)),
      taxableValueMinor:Math.max(0,parseMoneyMinor(cells[columns.taxable])),
      igstMinor:Math.max(0,parseMoneyMinor(columns.igst>=0?cells[columns.igst]:0)),
      cgstMinor:Math.max(0,parseMoneyMinor(columns.cgst>=0?cells[columns.cgst]:0)),
      sgstMinor:Math.max(0,parseMoneyMinor(columns.sgst>=0?cells[columns.sgst]:0)),
      cessMinor:Math.max(0,parseMoneyMinor(columns.cess>=0?cells[columns.cess]:0)),
      itcAvailable,reason:String(columns.reason>=0?cells[columns.reason]||"":"").trim(),sourceRow:index+2,duplicate,
    };
  }).filter(Boolean);
}
const normInvoice=(value)=>String(value||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
const closeAmount=(a,b)=>Math.abs(Number(a||0)-Number(b||0))<=1;
export function reconcileGstr2bRows(rows,purchaseBills) {
  const bills=Array.isArray(purchaseBills)?purchaseBills:[];
  return (Array.isArray(rows)?rows:[]).map((sourceRow)=>{
    const row={
      ...sourceRow,
      supplierGstin:sourceRow.supplierGstin||sourceRow.supplier_gstin||"",
      invoiceNumber:sourceRow.invoiceNumber||sourceRow.invoice_number||"",
      invoiceDate:sourceRow.invoiceDate||sourceRow.invoice_date||"",
      invoiceValueMinor:Number(sourceRow.invoiceValueMinor??sourceRow.invoice_value_minor??0),
      taxableValueMinor:Number(sourceRow.taxableValueMinor??sourceRow.taxable_value_minor??0),
      igstMinor:Number(sourceRow.igstMinor??sourceRow.igst_minor??0),
      cgstMinor:Number(sourceRow.cgstMinor??sourceRow.cgst_minor??0),
      sgstMinor:Number(sourceRow.sgstMinor??sourceRow.sgst_minor??0),
      cessMinor:Number(sourceRow.cessMinor??sourceRow.cess_minor??0),
      itcAvailable:sourceRow.itcAvailable??sourceRow.itc_available??null,
      reason:sourceRow.reason||"",
    };
    if(row.duplicate) return {...row,reconciliationStatus:"DUPLICATE",matchReason:"Duplicate invoice row in imported GSTR-2B file."};
    if(row.itcAvailable===false) return {...row,reconciliationStatus:"ITC_NOT_AVAILABLE",matchReason:row.reason||"ITC is marked unavailable in GSTR-2B."};
    const matches=bills.filter((bill)=>String(bill.supplier_tax_id||bill.supplier_gstin||"").toUpperCase()===row.supplierGstin&&normInvoice(bill.supplier_invoice_number)===normInvoice(row.invoiceNumber));
    if(!matches.length) return {...row,reconciliationStatus:"NOT_IN_BOOKS",matchReason:"No saved purchase bill with the same supplier GSTIN and invoice number."};
    if(matches.length>1) return {...row,reconciliationStatus:"REVIEW_REQUIRED",candidateCount:matches.length,matchReason:"Multiple purchase bills match this supplier invoice."};
    const bill=matches[0];\n    if(String(bill.currency_code||"").toUpperCase()!=="INR"||String(bill.base_currency_code||"").toUpperCase()!=="INR") return {...row,matchedPurchaseBillId:bill.id,reconciliationStatus:"CURRENCY_MISMATCH",matchReason:"The saved purchase bill is not recorded in INR; compare source currency before ITC review."};\n    const bookTax=Number(bill.tax_minor||0), portalTax=row.igstMinor+row.cgstMinor+row.sgstMinor+row.cessMinor;
    const amountsMatch=[closeAmount(bill.subtotal_minor,row.taxableValueMinor),closeAmount(bill.total_minor,row.invoiceValueMinor||row.taxableValueMinor+portalTax),closeAmount(bookTax,portalTax),closeAmount(bill.tax_recoverable_minor,portalTax)].every(Boolean);
    return {...row,matchedPurchaseBillId:bill.id,matchedSupplierName:bill.supplier_name||row.supplierName,
      reconciliationStatus:amountsMatch?"MATCHED":"AMOUNT_MISMATCH",
      matchReason:amountsMatch?"Supplier GSTIN, invoice number and tax totals match the saved purchase bill.":"Supplier and invoice matched, but taxable value, invoice total or tax/ITC amount differs.",
      bookTaxMinor:bookTax,portalTaxMinor:portalTax,bookTaxableMinor:Number(bill.subtotal_minor||0),bookTotalMinor:Number(bill.total_minor||0)};
  });
}
