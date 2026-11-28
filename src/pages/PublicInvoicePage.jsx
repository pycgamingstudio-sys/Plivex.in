import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/api/backendClient";
import { getCurrencyLocale, formatMoney } from "@/lib/currency";
import { getCountryExperience } from "@/global/countries/country-experience.js";
import { FileDown, Printer, ShieldCheck, AlertCircle } from "lucide-react";

const resolveLocale=(invoice)=>{
 const business=invoice?.invoice_snapshot?.business||{};
 const requested=invoice?.invoice_snapshot?.locale_code||business.locale||business.countryLocale||invoice?.invoice_snapshot?.globalTaxProfileSnapshot?.localeCode||invoice?.invoice_snapshot?.globalTax?.localeCode;
 if(requested){try{return new Intl.Locale(requested).toString()}catch{}}
 try{return getCurrencyLocale(invoice?.currency||"INR")}catch{return "en-IN"}
};
const money=(value,currency,locale)=>{try{return formatMoney(value,currency||"INR",locale)}catch{return String(value??"0")}};
const date=(value,locale)=>{if(!value)return "—";try{return new Date(value+"T00:00:00").toLocaleDateString(locale,{day:"2-digit",month:"short",year:"numeric"})}catch{return value}};
const minorDigits=(currency)=>{try{return new Intl.NumberFormat("en",{style:"currency",currency}).resolvedOptions().maximumFractionDigits}catch{return 2}};
const moneyMinor=(value,currency,locale)=>new Intl.NumberFormat(locale||"en",{style:"currency",currency}).format(Number(value||0)/(10**minorDigits(currency)));
const addressText=(value)=>typeof value==="string"?value:(value?.formatted||value?.address||"");
const globalDocumentTitle=(snapshot)=>{
 if(snapshot?.document_status==="draft")return "DRAFT INVOICE";
 if(snapshot?.document_type==="commercial_invoice")return "COMMERCIAL INVOICE";
 if(snapshot?.tax_status==="calculated")return "TAX INVOICE";
 return "INVOICE";
};

function GlobalPublicInvoice({ snapshot }) {
 const currency=String(snapshot.currency_code||"").trim().toUpperCase();
 if(!/^[A-Z]{3}$/.test(currency))return <main className="min-h-screen grid place-items-center bg-slate-50 p-5"><section className="rounded-2xl border bg-white p-8 text-center shadow-sm"><h1 className="text-lg font-bold">Invoice unavailable</h1><p className="mt-2 text-sm text-slate-600">The saved invoice currency is missing or invalid. Contact the issuing business for a corrected link.</p></section></main>;
 const locale=snapshot.locale_code||"en";
 const seller=snapshot.seller||{};
 const buyer=snapshot.buyer||{};
 const items=Array.isArray(snapshot.items)?snapshot.items:[];
 const draft=snapshot.document_status==="draft";
 const title=globalDocumentTitle(snapshot);
 const taxNotAssessed=["not_assessed","not_calculated",undefined,null].includes(snapshot.tax_status);
 const taxDisclosure=snapshot.tax_disclosure||"Tax has not been calculated or validated by Plivex. Confirm the applicable treatment before using this document for tax reporting.";
 return <main className="min-h-screen bg-slate-50 px-3 py-6 text-slate-900 sm:px-6">
  <div className="mx-auto max-w-3xl">
   <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
    <div className="flex items-center gap-2 text-sm text-slate-600"><ShieldCheck className="h-4 w-4 text-emerald-600"/> Secure Global invoice link <span className="text-slate-300">•</span> Powered by Plivex</div>
    <div className="flex gap-2"><button onClick={()=>window.print()} className="rounded-lg border bg-white px-3 py-2 text-sm font-semibold"><Printer className="mr-1 inline h-4 w-4"/> Print</button><button onClick={()=>window.print()} className="rounded-lg bg-violet-700 px-3 py-2 text-sm font-semibold text-white"><FileDown className="mr-1 inline h-4 w-4"/> Save as PDF</button></div>
   </div>
   <article className="relative overflow-hidden rounded-xl border bg-white p-5 shadow-sm sm:p-9 print:border-0 print:shadow-none">
    {draft&&<div className="mb-5 rounded-lg border-2 border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-center text-sm font-bold tracking-wide text-amber-800">DRAFT — NOT ISSUED · NOT A TAX INVOICE</div>}
    <header className="flex flex-wrap justify-between gap-5 border-b pb-6">
     <div><div className="text-xs font-bold uppercase tracking-widest text-violet-700">{seller.display_name||seller.legal_name||"Plivex business"}</div><h1 className="mt-2 text-3xl font-bold">{title}</h1><p className="mt-1 text-sm text-slate-500">#{snapshot.invoice_number||"DRAFT"}</p></div>
     <div className="max-w-[230px] text-right text-sm"><div className="font-semibold">{seller.legal_name||seller.display_name||"Seller"}</div><div className="whitespace-pre-line text-slate-500">{seller.address||""}</div>{seller.tax_registration_number&&<div className="mt-1 text-xs">{seller.tax_registration_type||"Tax registration"}: {seller.tax_registration_number}</div>}</div>
    </header>
    <section className="grid gap-5 py-6 sm:grid-cols-2">
     <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Bill to</div><div className="mt-2 font-semibold">{buyer.name||"Customer"}</div><div className="whitespace-pre-line text-sm text-slate-600">{addressText(buyer.billing_address)||addressText(buyer.shipping_address)}</div>{buyer.tax_registration_number&&<div className="text-sm text-slate-600">Tax registration: {buyer.tax_registration_number}</div>}</div>
     <div className="grid grid-cols-2 gap-3 text-sm"><div><div className="text-slate-400">Invoice date</div><div className="mt-1 font-semibold">{date(snapshot.issue_date,locale)}</div></div><div><div className="text-slate-400">Due date</div><div className="mt-1 font-semibold">{date(snapshot.due_date,locale)}</div></div><div><div className="text-slate-400">Status</div><div className="mt-1 inline-block rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">{draft?"DRAFT — NOT ISSUED":snapshot.document_status||"Issued"}</div></div><div><div className="text-slate-400">Currency</div><div className="mt-1 font-semibold">{currency}</div></div></div>
    </section>
    <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-left text-sm"><thead><tr className="border-y bg-slate-50 text-xs uppercase text-slate-500"><th className="px-3 py-3">Description</th><th className="px-3 py-3 text-right">Qty</th><th className="px-3 py-3 text-right">Rate</th><th className="px-3 py-3 text-right">Amount</th></tr></thead><tbody>
     {items.map((item,index)=><tr key={item.id||index} className="border-b"><td className="px-3 py-3">{item.description||"Item"}</td><td className="px-3 py-3 text-right">{Number(item.quantity)||0}</td><td className="px-3 py-3 text-right">{moneyMinor(item.unit_price_minor,currency,locale)}</td><td className="px-3 py-3 text-right font-medium">{moneyMinor(item.line_total_minor,currency,locale)}</td></tr>)}
    </tbody></table></div>
    <section className="ml-auto mt-6 max-w-xs space-y-2 text-sm">
     <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span>{moneyMinor(snapshot.subtotal_minor,currency,locale)}</span></div>
     <div className="flex justify-between"><span className="text-slate-500">Discount</span><span>{moneyMinor(snapshot.discount_minor,currency,locale)}</span></div>
     <div className="flex justify-between"><span className="text-slate-500">{taxNotAssessed?"Tax (not assessed)": "Tax"}</span><span>{taxNotAssessed?"Not assessed":moneyMinor(snapshot.tax_minor,currency,locale)}</span></div>
     <div className="flex justify-between border-t pt-3 text-lg font-bold"><span>Total</span><span>{moneyMinor(snapshot.total_minor,currency,locale)}</span></div>
    </section>
    {upiValid&&<section className="mt-6 rounded-xl border border-violet-200 bg-violet-50 p-4" data-testid="invoice-upi-payment"><div className="flex flex-wrap items-center justify-between gap-4"><div className="min-w-0"><h2 className="font-semibold text-violet-950">Pay this invoice via UPI</h2><p className="mt-1 text-xs text-violet-800">UPI ID: {upiId}</p><p className="mt-1 text-xs text-violet-800">Amount: {money(total,invoice.currency,locale)}</p><p className="mt-2 text-[11px] text-violet-800">The business must verify receipt before marking the invoice as paid.</p><a href={upiUri} className="mt-3 inline-flex rounded-lg bg-violet-700 px-4 py-2 text-sm font-semibold text-white">Pay via UPI</a></div><img src={upiQrUrl} alt="UPI payment QR code" className="h-32 w-32 rounded-lg border bg-white p-1"/></div></section>}
    <section className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-700" data-testid="global-tax-declaration">
     <p className="font-semibold text-slate-900">Tax declaration</p>
     {snapshot.tax_treatment&&<p>Tax treatment: {String(snapshot.tax_treatment).replace(/-/g," ")}</p>}
     {snapshot.tax_category&&<p>Supply category: {snapshot.tax_category}</p>}
     {taxNotAssessed&&<p className="font-semibold text-amber-800">Tax has not been assessed or calculated.</p>}
     <p>{taxDisclosure}</p>
     {snapshot.tax_rule_source&&<a className="underline" href={snapshot.tax_rule_source} target="_blank" rel="noreferrer">Tax rule source</a>}
    </section>
    {(snapshot.notes||snapshot.terms)&&<section className="mt-7 border-t pt-5 text-sm"><div className="font-semibold">Notes</div><p className="mt-1 whitespace-pre-line text-slate-600">{snapshot.notes}</p>{snapshot.terms&&<><div className="mt-4 font-semibold">Terms & conditions</div><p className="mt-1 whitespace-pre-line text-slate-600">{snapshot.terms}</p></>}</section>}
    <footer className="mt-8 border-t pt-4 text-center text-xs text-slate-400">Shared securely through Plivex. This document reflects the invoice snapshot at the time the link was created.</footer>
   </article>
   <p className="mt-4 text-center text-xs text-slate-400 print:hidden">This secure link may expire or be revoked by the issuing business.</p>
  </div>
 </main>;
}

export default function PublicInvoicePage(){
 const {token=""}=useParams();
 const [invoice,setInvoice]=useState(null);
 const [globalSnapshot,setGlobalSnapshot]=useState(null);
 const [error,setError]=useState("");
 const [loading,setLoading]=useState(true);
 useEffect(()=>{let live=true;(async()=>{
  try{
   const globalResult=await supabase.functions.invoke("global-invoice-share",{body:{action:"resolve",token}});
   if(!globalResult.error&&globalResult.data?.ok&&globalResult.data?.snapshot){
    const shared=globalResult.data.snapshot;
    if(!/^[A-Z]{3}$/.test(String(shared.currency_code||"").trim().toUpperCase())||typeof shared.country_code!=="string"||!shared.country_code.trim()){
     throw new Error("This Global invoice link has an incomplete country or currency snapshot.");
    }
    if(live)setGlobalSnapshot(shared);
    return;
   }
   const {data,error:invokeError}=await supabase.functions.invoke("invoice-share",{body:{action:"public_view",token}});
   if(invokeError)throw new Error("This invoice link has expired or is unavailable.");
   if(data?.error)throw new Error(data.error);
   if(live)setInvoice(data.invoice);
  }catch(e){if(live)setError(e.message||"Invoice unavailable.");}
  finally{if(live)setLoading(false);}
 })();return()=>{live=false}},[token]);
 if(loading)return <main className="min-h-screen grid place-items-center bg-slate-50 text-slate-600">Loading secure invoice…</main>;
 if(globalSnapshot)return <GlobalPublicInvoice snapshot={globalSnapshot}/>;
 const snapshot=invoice?.invoice_snapshot||{};
 const items=Array.isArray(snapshot.items)?snapshot.items:(invoice?.invoice_items||[]);
 const seller=snapshot.seller||{};
 const buyer=snapshot.buyer||{};
 const business=snapshot.business||{
  name:seller.display_name||seller.displayName||seller.legal_name||seller.legalName||"",
  address:seller.address||"",
  gstin:seller.tax_registration_number||seller.taxRegistrationNumber||"",
 };
 const client=snapshot.client||{
  name:buyer.name||"",
  company:buyer.company||"",
  address:buyer.billing_address||buyer.shipping_address||"",
  gstin:buyer.tax_registration_number||"",
 };
 const taxProfile=snapshot.globalTaxProfileSnapshot||{};
 const globalTax=snapshot.globalTax||{};
 const locale=resolveLocale(invoice);
 const countryCode=snapshot.country_code||taxProfile.countryCode||globalTax.countryCode||"IN";
 const documentStatus=snapshot.document_status||snapshot.documentStatus||(invoice?.is_draft?"draft":"issued");
 const isDraft=documentStatus==="draft"||invoice?.is_draft===true;
 const documentTitle=snapshot.document_type==="commercial_invoice"?"COMMERCIAL INVOICE":snapshot.tax_status==="calculated"?"TAX INVOICE":"INVOICE";
 const taxNotAssessed=snapshot.tax_status==="not_assessed";
 const taxDisclosure=snapshot.tax_disclosure||"Tax has not been calculated or validated by Plivex. Confirm the applicable treatment before using this document for tax reporting.";
 const registrationLabel=countryCode==="IN"?"GSTIN":(taxProfile.registrationType||getCountryExperience(countryCode)?.business.registrationLabel||"Tax registration");
 const total=Number(invoice?.total??snapshot.total)||0;
 const upiId=String(snapshot.upiId||"").trim();
 const upiValid=countryCode==="IN"&&String(invoice?.currency||"").toUpperCase()==="INR"&&/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9.\-_]{1,64}$/.test(upiId)&&total>0&&!isDraft&&String(invoice?.status||"").toLowerCase()!=="paid";
 const upiUri=upiValid?`upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(business.name||invoice?.business_name||"Business")}&am=${total.toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Invoice ${invoice?.number||""}`)}`:"";
 const upiQrUrl=upiValid?`https://quickchart.io/qr?size=360&margin=2&ecLevel=Q&text=${encodeURIComponent(upiUri)}`:"";
 const download=async()=>{await supabase.functions.invoke("invoice-share",{body:{action:"track",event:"download",token}});window.print()};
 if(error||!invoice)return <main className="min-h-screen grid place-items-center bg-slate-50 p-5"><section className="max-w-md rounded-2xl border bg-white p-8 text-center shadow-sm"><AlertCircle className="mx-auto mb-3 h-10 w-10 text-amber-600"/><h1 className="text-xl font-bold text-slate-900">Invoice unavailable</h1><p className="mt-2 text-sm text-slate-600">{error||"This invoice link is invalid."}</p><p className="mt-5 text-xs text-slate-400">If you need a fresh copy, contact the business that sent this invoice.</p></section></main>;
 return <main className="min-h-screen bg-slate-50 px-3 py-6 text-slate-900 sm:px-6">
  <div className="mx-auto max-w-3xl">
   <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden"><div className="flex items-center gap-2 text-sm text-slate-600"><ShieldCheck className="h-4 w-4 text-emerald-600"/> Secure invoice link <span className="text-slate-300">•</span> Powered by Plivex</div><div className="flex gap-2"><button onClick={()=>window.print()} className="rounded-lg border bg-white px-3 py-2 text-sm font-semibold"><Printer className="mr-1 inline h-4 w-4"/> Print</button><button onClick={download} className="rounded-lg bg-violet-700 px-3 py-2 text-sm font-semibold text-white"><FileDown className="mr-1 inline h-4 w-4"/> Save as PDF</button></div></div>
   <article className="rounded-xl border bg-white p-5 shadow-sm sm:p-9 print:border-0 print:shadow-none">
    {isDraft&&<div className="mb-5 rounded-lg border-2 border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-center text-sm font-bold tracking-wide text-amber-800">DRAFT — NOT ISSUED · NOT A TAX INVOICE</div>}
    {taxProfile.countryCode&&taxProfile.countryCode!=="IN"&&<section className="mb-5 border-b pb-4 text-sm text-slate-700" data-testid="public-global-tax-profile"><h2 className="font-semibold">Tax registration details (business supplied)</h2><p>{taxProfile.registrationType||"Tax registration"}: {taxProfile.registrationNumber||"Not provided"}</p><p>Status: {taxProfile.registrationStatus||"Not provided"} · Effective from: {taxProfile.registrationEffectiveFrom||"—"}</p><p>Registered jurisdiction: {taxProfile.registeredJurisdiction||"—"}</p><p>Place of supply: {globalTax.placeOfSupply||"—"} · Treatment: {globalTax.taxCategory||"—"}</p></section>}
    <header className="flex flex-wrap justify-between gap-5 border-b pb-6"><div><div className="text-xs font-bold uppercase tracking-widest text-violet-700">{business.name||seller.legal_name||seller.legalName||invoice.business_name||"Invoice"}</div><h1 className="mt-2 text-3xl font-bold">{isDraft?"DRAFT INVOICE":documentTitle}</h1><p className="mt-1 text-sm text-slate-500">#{invoice.number}</p></div><div className="text-right text-sm"><div className="font-semibold">{business.name||seller.legal_name||seller.legalName||invoice.business_name}</div><div className="whitespace-pre-line text-slate-500">{business.address||seller.address||""}</div>{(business.gstin||seller.tax_registration_number||seller.taxRegistrationNumber)&&<div className="mt-1">{registrationLabel}: {business.gstin||seller.tax_registration_number||seller.taxRegistrationNumber}</div>}</div></header>
    <section className="grid gap-5 py-6 sm:grid-cols-2"><div><div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Bill to</div><div className="mt-2 font-semibold">{client.name||invoice.client_name||"Customer"}</div><div className="text-sm text-slate-600">{client.company||""}</div><div className="whitespace-pre-line text-sm text-slate-600">{client.address||""}</div>{client.gstin&&<div className="text-sm text-slate-600">{registrationLabel}: {client.gstin}</div>}</div><div className="grid grid-cols-2 gap-3 text-sm"><div><div className="text-slate-400">Invoice date</div><div className="mt-1 font-semibold">{date(invoice.issue_date,locale)}</div></div><div><div className="text-slate-400">Due date</div><div className="mt-1 font-semibold">{date(invoice.due_date,locale)}</div></div><div><div className="text-slate-400">Status</div><div className="mt-1 inline-block rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">{isDraft?"DRAFT — NOT ISSUED":invoice.status||"Pending"}</div></div></div></section>
    <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-left text-sm"><thead><tr className="border-y bg-slate-50 text-xs uppercase text-slate-500"><th className="px-3 py-3">Description</th><th className="px-3 py-3 text-right">Qty</th><th className="px-3 py-3 text-right">Rate</th><th className="px-3 py-3 text-right">Amount</th></tr></thead><tbody>{items.map((item,index)=>{const qty=Number(item.quantity)||0;const rate=Number(item.rate)||0;return <tr key={item.id||index} className="border-b"><td className="px-3 py-3">{item.description||"Item"}</td><td className="px-3 py-3 text-right">{qty}</td><td className="px-3 py-3 text-right">{money(rate,invoice.currency,locale)}</td><td className="px-3 py-3 text-right font-medium">{money(qty*rate,invoice.currency,locale)}</td></tr>})}</tbody></table></div>
    <section className="ml-auto mt-6 max-w-xs space-y-2 text-sm"><div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span>{money(invoice.subtotal,invoice.currency,locale)}</span></div>{Number(invoice.discount)>0&&<div className="flex justify-between"><span className="text-slate-500">Discount</span><span>{money(invoice.discount,invoice.currency,locale)}</span></div>}{taxNotAssessed&&<div className="flex justify-between"><span className="text-slate-500">Tax</span><span>Not assessed</span></div>}{Number(invoice.cgst)>0&&<div className="flex justify-between"><span className="text-slate-500">CGST</span><span>{money(invoice.cgst,invoice.currency,locale)}</span></div>}{Number(invoice.sgst)>0&&<div className="flex justify-between"><span className="text-slate-500">SGST</span><span>{money(invoice.sgst,invoice.currency,locale)}</span></div>}{Number(invoice.igst)>0&&<div className="flex justify-between"><span className="text-slate-500">IGST</span><span>{money(invoice.igst,invoice.currency,locale)}</span></div>}<div className="flex justify-between border-t pt-3 text-lg font-bold"><span>Total</span><span>{money(total,invoice.currency,locale)}</span></div></section>
    {taxNotAssessed&&<section className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">{taxDisclosure}</section>}
    {(snapshot.notes||snapshot.terms)&&<section className="mt-7 border-t pt-5 text-sm"><div className="font-semibold">Notes</div><p className="mt-1 whitespace-pre-line text-slate-600">{snapshot.notes}</p>{snapshot.terms&&<><div className="mt-4 font-semibold">Terms & conditions</div><p className="mt-1 whitespace-pre-line text-slate-600">{snapshot.terms}</p></>}</section>}
    <footer className="mt-8 border-t pt-4 text-center text-xs text-slate-400">This is a digitally shared invoice. For questions, contact the issuing business.</footer>
   </article>
   <p className="mt-4 text-center text-xs text-slate-400 print:hidden">Your invoice is shared securely through Plivex.</p>
  </div>
 </main>;
}
