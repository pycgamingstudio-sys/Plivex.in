// Invoice design registry. `premium: true` layouts unlock on the Pro plan only;
// the two free layouts ship with every account (including the 14-day trial).

export const INVOICE_DESIGNS = [
  { id: "classic", label: "Classic", premium: false, blurb: "Timeless ruled layout" },
  { id: "modern", label: "Modern", premium: false, blurb: "Bold colour header" },
  { id: "minimal", label: "Minimal", premium: true, blurb: "Airy, monospaced detail" },
  { id: "executive", label: "Executive", premium: true, blurb: "Dark side rail" },
  { id: "elegant", label: "Elegant", premium: true, blurb: "Serif editorial" },
];

export const DEFAULT_DESIGN_ID = "classic";

export function isPremiumDesign(id) {
  return Boolean(INVOICE_DESIGNS.find((design) => design.id === id)?.premium);
}

function initials(name) {
  const parts = String(name || "Your business").trim().split(/\s+/).filter(Boolean);
  return (parts.map((word) => word[0]).slice(0, 2).join("") || "P").toUpperCase();
}

function ItemsTable({ invoice, money, headerClass = "", rowClass = "border-[#eeeef2]" }) {
  return (
    <div>
      <div className={`grid grid-cols-[1fr_45px_94px_100px] gap-3 border-b pb-2 font-mono-ui text-[9px] uppercase tracking-wider ${headerClass}`}>
        <span>Description</span><span className="text-center">Qty</span><span className="text-right">Rate</span><span className="text-right">Amount</span>
      </div>
      {invoice.items.map((item) => {
        const quantity = Number(item.quantity) || 0;
        const rate = Number(item.rate) || 0;
        return (
          <div key={item.id} className={`grid grid-cols-[1fr_45px_94px_100px] gap-3 border-b py-4 text-[11px] ${rowClass}`}>
            <span className="font-medium">{item.description || "Untitled service"}<small className="mt-1 block text-[9px] font-normal text-[#8b889b]">GST {item.gstRate ?? invoice.taxRate}%</small></span>
            <span className="text-center text-[#77758a]">{item.quantity}</span>
            <span className="text-right text-[#77758a]">{money(rate, invoice.currency)}</span>
            <span className="text-right font-semibold">{money(quantity * rate, invoice.currency)}</span>
          </div>
        );
      })}
    </div>
  );
}

function Totals({ invoice, subtotal, discount, discountValue, taxValue, total, money, amountInWords, accent = "#2e2857" }) {
  return (
    <div className="w-[260px] space-y-2 text-[11px]">
      <div className="flex justify-between text-[#77758a]"><span>Subtotal</span><span>{money(subtotal, invoice.currency)}</span></div>
      {discountValue > 0 && <div className="flex justify-between text-[#77758a]"><span>Discount {invoice.discountType === "percent" ? `(${discount}%)` : ""}</span><span>-{money(discountValue, invoice.currency)}</span></div>}
      <div className="flex justify-between text-[#77758a]"><span>{invoice.taxMode === "split" ? "CGST + SGST" : "IGST"} ({invoice.taxRate}%)</span><span>{money(taxValue, invoice.currency)}</span></div>
      {invoice.taxMode === "split" && <div className="flex justify-between text-[#8b889b]"><span>CGST / SGST</span><span>{money(taxValue / 2, invoice.currency)} each</span></div>}
      <div className="mt-3 flex items-end justify-between border-t-2 pt-3" style={{ borderColor: accent }}>
        <span className="font-bold">Total due</span>
        <span className="text-[20px] font-bold tracking-[-0.04em]" style={{ color: accent }}>{money(total, invoice.currency)}</span>
      </div>
      <p className="pt-1 text-right text-[9px] italic text-[#8b889b]">{amountInWords(total, invoice.currency)}</p>
    </div>
  );
}

function NotesBlock({ invoice }) {
  return (
    <div>
      <p className="font-mono-ui text-[9px] uppercase tracking-[0.14em] text-[#8b889b]">Note</p>
      <p className="mt-2 max-w-[360px] whitespace-pre-line text-[10px] leading-relaxed text-[#77758a]">{invoice.notes}</p>
      <p className="mt-5 font-mono-ui text-[9px] uppercase tracking-[0.14em] text-[#8b889b]">Terms</p>
      <p className="mt-2 max-w-[360px] whitespace-pre-line text-[10px] leading-relaxed text-[#77758a]">{invoice.terms}</p>
    </div>
  );
}

function SignatureBlock({ invoice }) {
  return (
    <div className="text-right">
      {invoice.signature ? <img src={invoice.signature} alt="Signature" className="ml-auto h-12 max-w-[150px] object-contain" /> : <div className="ml-auto h-12 w-[150px] border-b border-dashed border-[#aaa7b8]" />}
      <p className="mt-2 text-[10px] font-semibold">{invoice.business.name}</p>
      <p className="text-[9px] text-[#8b889b]">Authorised signature</p>
    </div>
  );
}

function UpiBlock({ upiValid, qrUrl }) {
  if (!upiValid) return null;
  return (
    <div className="mt-10 flex flex-col items-center gap-2 border-t border-[#eeeef2] pt-6">
      <img src={qrUrl} alt="UPI payment QR code" crossOrigin="anonymous" className="h-[120px] w-[120px] rounded-md bg-white" />
      <p className="font-mono-ui text-[9px] uppercase tracking-[0.14em] text-[#8b889b]">Scan to Pay via UPI</p>
    </div>
  );
}

function Footer({ light = false }) {
  return (
    <div className={`mt-16 flex items-center justify-between border-t pt-4 text-[9px] ${light ? "border-white/20 text-white/60" : "border-[#eeeef2] text-[#aaa7b8]"}`}>
      <span>Made with Plivex</span><span className="font-mono-ui">01 / 01</span>
    </div>
  );
}

function ClassicDesign({ invoice, subtotal, discount, discountValue, taxValue, total, upiValid, qrUrl, money, dateLabel, amountInWords }) {
  return (
    <div className="min-h-[1122px] p-7 sm:p-12">
      <div className="flex items-start justify-between gap-6 border-b-2 border-[#2e2857] pb-7">
        <div className="flex items-start gap-3">
          {invoice.logo ? <img src={invoice.logo} alt="Business logo" className="h-12 w-12 rounded-lg object-contain" /> : <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#2e2857] text-sm font-bold text-white">{initials(invoice.business.name)}</div>}
          <div>
            <h2 className="max-w-[260px] text-[22px] font-bold leading-tight tracking-[-0.05em]">{invoice.business.name || "Your business"}</h2>
            <p className="mt-1 whitespace-pre-line text-[10px] leading-relaxed text-[#77758a]">{invoice.business.address}</p>
            <p className="mt-1 text-[10px] text-[#77758a]">{invoice.business.email} · {invoice.business.phone}</p>
            {invoice.business.gstin && <p className="mt-1 font-mono-ui text-[9px] text-[#77758a]">GSTIN {invoice.business.gstin}</p>}
          </div>
        </div>
        <div className="text-right">
          <p className="font-mono-ui text-[10px] uppercase tracking-[0.17em] text-[#77758a]">Invoice</p>
          <p className="mt-1 text-[19px] font-bold tracking-[-0.04em] text-[#2e2857]">{invoice.number || "INV-000"}</p>
          <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-1 text-[10px]">
            <span className="text-[#77758a]">Issued</span><span className="font-medium">{dateLabel(invoice.issueDate)}</span>
            <span className="text-[#77758a]">Due</span><span className="font-medium">{dateLabel(invoice.dueDate)}</span>
          </div>
        </div>
      </div>
      <div className="flex justify-between gap-8 border-b border-[#e4e1eb] py-7">
        <div>
          <p className="font-mono-ui text-[9px] uppercase tracking-[0.14em] text-[#8b889b]">Billed to</p>
          <p className="mt-2 text-[14px] font-bold">{invoice.client.name || "Client name"}</p>
          <p className="mt-0.5 text-[11px] font-medium text-[#555267]">{invoice.client.company}</p>
          <p className="mt-2 whitespace-pre-line text-[10px] leading-relaxed text-[#77758a]">{invoice.client.address}</p>
          <p className="mt-1 text-[10px] text-[#77758a]">{invoice.client.email} · {invoice.client.phone}</p>
          {invoice.client.gstin && <p className="mt-1 font-mono-ui text-[9px] text-[#77758a]">GSTIN {invoice.client.gstin}</p>}
        </div>
        <div className="max-w-[190px] self-end text-right">
          <p className="font-display text-[19px] italic leading-none text-[#645b9d]">Thank you for your business.</p>
        </div>
      </div>
      <div className="mt-8"><ItemsTable invoice={invoice} money={money} headerClass="border-[#2e2857] text-[#77758a]" /></div>
      <div className="mt-8 flex justify-end"><Totals invoice={invoice} subtotal={subtotal} discount={discount} discountValue={discountValue} taxValue={taxValue} total={total} money={money} amountInWords={amountInWords} /></div>
      <div className="mt-14 grid gap-10 border-t border-[#e4e1eb] pt-6 sm:grid-cols-[1fr_180px]"><NotesBlock invoice={invoice} /><SignatureBlock invoice={invoice} /></div>
      <UpiBlock upiValid={upiValid} qrUrl={qrUrl} />
      <Footer />
    </div>
  );
}

function ModernDesign({ invoice, subtotal, discount, discountValue, taxValue, total, upiValid, qrUrl, money, dateLabel, amountInWords }) {
  return (
    <div className="min-h-[1122px]">
      <div className="bg-[#6D28D9] px-7 py-9 text-white sm:px-12">
        <div className="flex items-start justify-between gap-6">
          <div className="flex items-center gap-3">
            {invoice.logo ? <img src={invoice.logo} alt="Business logo" className="h-12 w-12 rounded-xl bg-white object-contain p-1" /> : <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 text-sm font-bold">{initials(invoice.business.name)}</div>}
            <div>
              <h2 className="max-w-[260px] text-[21px] font-bold leading-tight tracking-[-0.04em]">{invoice.business.name || "Your business"}</h2>
              <p className="mt-1 text-[10px] text-white/75">{invoice.business.email} · {invoice.business.phone}</p>
              {invoice.business.gstin && <p className="mt-0.5 font-mono-ui text-[9px] text-white/70">GSTIN {invoice.business.gstin}</p>}
            </div>
          </div>
          <div className="text-right">
            <p className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-white/70">Invoice</p>
            <p className="mt-1 text-[22px] font-bold tracking-[-0.03em]">{invoice.number || "INV-000"}</p>
          </div>
        </div>
      </div>
      <div className="p-7 sm:p-12">
        <div className="grid grid-cols-2 gap-6 border-b border-[#e4e1eb] pb-6">
          <div>
            <p className="font-mono-ui text-[9px] uppercase tracking-[0.14em] text-[#8b889b]">Billed to</p>
            <p className="mt-2 text-[14px] font-bold">{invoice.client.name || "Client name"}</p>
            <p className="mt-0.5 text-[11px] font-medium text-[#555267]">{invoice.client.company}</p>
            <p className="mt-2 whitespace-pre-line text-[10px] leading-relaxed text-[#77758a]">{invoice.client.address}</p>
            <p className="mt-1 text-[10px] text-[#77758a]">{invoice.client.email} · {invoice.client.phone}</p>
          </div>
          <div className="text-right text-[10px]">
            <p className="text-[#8b889b]">Issued <span className="font-medium text-[#28263a]">{dateLabel(invoice.issueDate)}</span></p>
            <p className="mt-1.5 text-[#8b889b]">Due <span className="font-medium text-[#28263a]">{dateLabel(invoice.dueDate)}</span></p>
            {invoice.client.gstin && <p className="mt-1.5 font-mono-ui text-[9px] text-[#77758a]">GSTIN {invoice.client.gstin}</p>}
          </div>
        </div>
        <div className="mt-8">
          <div className="grid grid-cols-[1fr_45px_94px_100px] gap-3 rounded-t-lg bg-[#f4f1fd] px-3 py-2 font-mono-ui text-[9px] uppercase tracking-wider text-[#6D28D9]">
            <span>Description</span><span className="text-center">Qty</span><span className="text-right">Rate</span><span className="text-right">Amount</span>
          </div>
          <div className="px-3">
            {invoice.items.map((item) => {
              const quantity = Number(item.quantity) || 0;
              const rate = Number(item.rate) || 0;
              return (
                <div key={item.id} className="grid grid-cols-[1fr_45px_94px_100px] gap-3 border-b border-[#eeeef2] py-4 text-[11px]">
                  <span className="font-medium">{item.description || "Untitled service"}<small className="mt-1 block text-[9px] font-normal text-[#8b889b]">GST {item.gstRate ?? invoice.taxRate}%</small></span>
                  <span className="text-center text-[#77758a]">{item.quantity}</span>
                  <span className="text-right text-[#77758a]">{money(rate, invoice.currency)}</span>
                  <span className="text-right font-semibold">{money(quantity * rate, invoice.currency)}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="mt-8 flex justify-end">
          <div className="rounded-2xl bg-[#faf8ff] p-5">
            <Totals invoice={invoice} subtotal={subtotal} discount={discount} discountValue={discountValue} taxValue={taxValue} total={total} money={money} amountInWords={amountInWords} accent="#6D28D9" />
            <p className="mt-4 max-w-[260px] border-t border-[#e4dcfb] pt-3 font-display text-[16px] italic leading-snug text-[#6D28D9]">Thank you for your business.</p>
          </div>
        </div>
        <div className="mt-14 grid gap-10 border-t border-[#e4e1eb] pt-6 sm:grid-cols-[1fr_180px]"><NotesBlock invoice={invoice} /><SignatureBlock invoice={invoice} /></div>
        <UpiBlock upiValid={upiValid} qrUrl={qrUrl} />
        <Footer />
      </div>
    </div>
  );
}

function MinimalDesign({ invoice, subtotal, discount, discountValue, taxValue, total, upiValid, qrUrl, money, dateLabel, amountInWords }) {
  return (
    <div className="min-h-[1122px] p-8 sm:p-14">
      <div className="flex items-start justify-between gap-8">
        <div className="flex items-start gap-3.5">
          {invoice.logo ? <img src={invoice.logo} alt="Business logo" className="h-11 w-11 rounded-lg object-contain" /> : <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-[#28263a] text-[13px] font-bold tracking-[-0.02em]">{initials(invoice.business.name)}</div>}
          <div>
            <h2 className="text-[15px] font-bold uppercase tracking-[0.14em]">{invoice.business.name || "Your business"}</h2>
            <p className="mt-1.5 whitespace-pre-line text-[9px] leading-relaxed text-[#8b889b]">{invoice.business.address}</p>
            <p className="text-[9px] text-[#8b889b]">{invoice.business.email}{invoice.business.phone ? ` · ${invoice.business.phone}` : ""}</p>
            {invoice.business.gstin && <p className="mt-1 font-mono-ui text-[8px] tracking-[0.1em] text-[#8b889b]">GSTIN {invoice.business.gstin}</p>}
          </div>
        </div>
        <div className="text-right">
          <p className="text-[26px] font-light uppercase leading-none tracking-[0.3em] text-[#28263a]">Invoice</p>
          <p className="mt-2 font-mono-ui text-[11px] tracking-[0.06em] text-[#8b889b]">{invoice.number || "INV-000"}</p>
        </div>
      </div>
      <div className="mt-7 h-px w-full bg-[#28263a]" />
      <div className="mt-1 h-px w-full bg-[#28263a]/25" />
      <div className="mt-10 grid grid-cols-2 gap-8 text-[9px]">
        <div>
          <p className="font-mono-ui uppercase tracking-[0.2em] text-[#8b889b]">Billed to</p>
          <p className="mt-2 text-[12px] font-bold">{invoice.client.name || "Client name"}</p>
          <p className="mt-1 whitespace-pre-line leading-relaxed text-[#8b889b]">{invoice.client.address}</p>
          <p className="mt-1 text-[#8b889b]">{invoice.client.email}</p>
        </div>
        <div className="text-right">
          <p className="text-[#8b889b]">Issued <span className="font-medium text-[#28263a]">{dateLabel(invoice.issueDate)}</span></p>
          <p className="mt-1 text-[#8b889b]">Due <span className="font-medium text-[#28263a]">{dateLabel(invoice.dueDate)}</span></p>
          {invoice.business.gstin && <p className="mt-1 font-mono-ui text-[#8b889b]">GSTIN {invoice.business.gstin}</p>}
        </div>
      </div>
      <div className="mt-12">
        <div className="grid grid-cols-[1fr_45px_94px_100px] gap-3 border-b border-[#d9d7e0] pb-2 font-mono-ui text-[8px] uppercase tracking-[0.18em] text-[#8b889b]">
          <span>Description</span><span className="text-center">Qty</span><span className="text-right">Rate</span><span className="text-right">Amount</span>
        </div>
        {invoice.items.map((item) => {
          const quantity = Number(item.quantity) || 0;
          const rate = Number(item.rate) || 0;
          return (
            <div key={item.id} className="grid grid-cols-[1fr_45px_94px_100px] gap-3 border-b border-[#f1f0f4] py-5 text-[11px]">
              <span>{item.description || "Untitled service"}</span>
              <span className="text-center font-mono-ui text-[10px] text-[#77758a]">{item.quantity}</span>
              <span className="text-right font-mono-ui text-[10px] text-[#77758a]">{money(rate, invoice.currency)}</span>
              <span className="text-right font-mono-ui text-[10px]">{money(quantity * rate, invoice.currency)}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-10 flex items-end justify-between gap-6">
        <p className="max-w-[240px] font-display text-[16px] italic leading-snug text-[#8b889b]">Thank you for your business — it is a pleasure working with you.</p>
        <Totals invoice={invoice} subtotal={subtotal} discount={discount} discountValue={discountValue} taxValue={taxValue} total={total} money={money} amountInWords={amountInWords} accent="#28263a" />
      </div>
      <div className="mt-16 grid gap-10 sm:grid-cols-[1fr_180px]"><NotesBlock invoice={invoice} /><SignatureBlock invoice={invoice} /></div>
      <UpiBlock upiValid={upiValid} qrUrl={qrUrl} />
      <Footer />
    </div>
  );
}

function ExecutiveDesign({ invoice, subtotal, discount, discountValue, taxValue, total, upiValid, qrUrl, money, dateLabel, amountInWords }) {
  return (
    <div className="flex min-h-[1122px] flex-col sm:flex-row">
      <div className="flex w-full shrink-0 flex-col bg-[#241f45] p-7 text-white sm:w-[230px]">
        <div className="h-1 w-12 bg-[#c9a24a]" />
        <div className="mt-6 flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 text-[15px] font-bold tracking-[-0.02em]">{initials(invoice.business.name)}</div>
        <p className="mt-4 text-[16px] font-bold leading-tight tracking-[-0.03em]">{invoice.business.name || "Your business"}</p>
        <p className="mt-3 whitespace-pre-line text-[9px] leading-relaxed text-white/55">{invoice.business.address}</p>
        <p className="mt-2 text-[9px] text-white/55">{invoice.business.email}</p>
        <p className="text-[9px] text-white/55">{invoice.business.phone}</p>
        {invoice.business.gstin && <p className="mt-2 font-mono-ui text-[8px] tracking-[0.08em] text-white/45">GSTIN {invoice.business.gstin}</p>}
        <div className="mt-7 border-t border-white/15 pt-5">
          <p className="font-mono-ui text-[8px] uppercase tracking-[0.24em] text-[#c9a24a]">Invoice</p>
          <p className="mt-2 text-[20px] font-bold tracking-[-0.03em]">{invoice.number || "INV-000"}</p>
          <p className="mt-3 text-[9px] text-white/60">Issued <span className="font-medium text-white">{dateLabel(invoice.issueDate)}</span></p>
          <p className="mt-1 text-[9px] text-white/60">Due <span className="font-medium text-white">{dateLabel(invoice.dueDate)}</span></p>
        </div>
        {upiValid && (
          <div className="mt-auto pt-8">
            <img src={qrUrl} alt="UPI payment QR code" crossOrigin="anonymous" className="h-[110px] w-[110px] rounded-lg bg-white p-1" />
            <p className="mt-2 font-mono-ui text-[8px] uppercase tracking-[0.14em] text-white/55">Scan to pay via UPI</p>
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1 p-7 sm:p-10">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="font-mono-ui text-[9px] uppercase tracking-[0.24em] text-[#c9a24a]">Statement of account</p>
            <h2 className="mt-1.5 text-[24px] font-bold tracking-[-0.045em] text-[#241f45]">Invoice</h2>
          </div>
          <div className="rounded-lg bg-[#f6f4fb] px-4 py-2.5 text-right">
            <p className="text-[9px] uppercase tracking-[0.16em] text-[#8b889b]">Amount due</p>
            <p className="mt-0.5 text-[16px] font-bold tracking-[-0.03em] text-[#241f45]">{money(total, invoice.currency)}</p>
          </div>
        </div>
        <div className="mt-7 flex items-start justify-between gap-6 border-y border-[#e4e1eb] py-5">
          <div>
            <p className="font-mono-ui text-[9px] uppercase tracking-[0.14em] text-[#8b889b]">Billed to</p>
            <p className="mt-2 text-[14px] font-bold">{invoice.client.name || "Client name"}</p>
            <p className="mt-0.5 text-[11px] font-medium text-[#555267]">{invoice.client.company}</p>
            <p className="mt-1.5 whitespace-pre-line text-[10px] leading-relaxed text-[#77758a]">{invoice.client.address}</p>
            <p className="mt-1 text-[10px] text-[#77758a]">{invoice.client.email} · {invoice.client.phone}</p>
          </div>
          <p className="max-w-[180px] self-center text-right font-display text-[16px] italic leading-snug text-[#c9a24a]">Thank you for your business.</p>
        </div>
        <div className="mt-8"><ItemsTable invoice={invoice} money={money} headerClass="border-[#241f45] text-[#77758a]" /></div>
        <div className="mt-8 flex justify-end"><Totals invoice={invoice} subtotal={subtotal} discount={discount} discountValue={discountValue} taxValue={taxValue} total={total} money={money} amountInWords={amountInWords} accent="#241f45" /></div>
        <div className="mt-12 grid gap-8 border-t border-[#e4e1eb] pt-6 sm:grid-cols-[1fr_170px]"><NotesBlock invoice={invoice} /><SignatureBlock invoice={invoice} /></div>
        <Footer />
      </div>
    </div>
  );
}

function ElegantDesign({ invoice, subtotal, discount, discountValue, taxValue, total, upiValid, qrUrl, money, dateLabel, amountInWords }) {
  return (
    <div className="min-h-[1122px] p-8 sm:p-14">
      <div className="border-b-4 border-double border-[#b9a86a] pb-6 text-center">
        <p className="font-display text-[26px] font-normal tracking-[-0.02em] text-[#28263a]">{invoice.business.name || "Your business"}</p>
        <p className="mt-2 text-[9px] uppercase tracking-[0.32em] text-[#8b889b]">Invoice</p>
      </div>
      <div className="mt-8 grid grid-cols-3 gap-6 text-[10px]">
        <div>
          <p className="font-display text-[12px] italic text-[#b9a86a]">From</p>
          <p className="mt-1.5 whitespace-pre-line leading-relaxed text-[#77758a]">{invoice.business.address}</p>
          <p className="mt-1 text-[#77758a]">{invoice.business.email}</p>
          {invoice.business.gstin && <p className="mt-1 font-mono-ui text-[9px] text-[#77758a]">GSTIN {invoice.business.gstin}</p>}
        </div>
        <div className="text-center">
          <p className="font-display text-[12px] italic text-[#b9a86a]">Billed to</p>
          <p className="mt-1.5 text-[12px] font-bold">{invoice.client.name || "Client name"}</p>
          <p className="mt-1 whitespace-pre-line leading-relaxed text-[#77758a]">{invoice.client.address}</p>
          <p className="mt-1 text-[#77758a]">{invoice.client.email}</p>
        </div>
        <div className="text-right">
          <p className="font-display text-[12px] italic text-[#b9a86a]">Details</p>
          <p className="mt-1.5 text-[#77758a]">No. <span className="font-medium text-[#28263a]">{invoice.number || "INV-000"}</span></p>
          <p className="mt-1 text-[#77758a]">Issued <span className="font-medium text-[#28263a]">{dateLabel(invoice.issueDate)}</span></p>
          <p className="mt-1 text-[#77758a]">Due <span className="font-medium text-[#28263a]">{dateLabel(invoice.dueDate)}</span></p>
        </div>
      </div>
      <div className="mt-10">
        <div className="grid grid-cols-[1fr_45px_94px_100px] gap-3 border-b border-[#28263a] pb-2 font-display text-[10px] italic text-[#8b889b]">
          <span>Description</span><span className="text-center">Qty</span><span className="text-right">Rate</span><span className="text-right">Amount</span>
        </div>
        {invoice.items.map((item) => {
          const quantity = Number(item.quantity) || 0;
          const rate = Number(item.rate) || 0;
          return (
            <div key={item.id} className="grid grid-cols-[1fr_45px_94px_100px] gap-3 border-b border-[#f1f0f4] py-4 text-[11px]">
              <span className="font-medium">{item.description || "Untitled service"}<small className="mt-1 block text-[9px] font-normal text-[#8b889b]">GST {item.gstRate ?? invoice.taxRate}%</small></span>
              <span className="text-center text-[#77758a]">{item.quantity}</span>
              <span className="text-right text-[#77758a]">{money(rate, invoice.currency)}</span>
              <span className="text-right font-semibold">{money(quantity * rate, invoice.currency)}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-8 flex items-end justify-between gap-6">
        <p className="max-w-[260px] font-display text-[16px] italic leading-snug text-[#b9a86a]">Thank you for your business.</p>
        <Totals invoice={invoice} subtotal={subtotal} discount={discount} discountValue={discountValue} taxValue={taxValue} total={total} money={money} amountInWords={amountInWords} accent="#b9a86a" />
      </div>
      <div className="mt-14 grid gap-10 border-t border-[#e4e1eb] pt-6 sm:grid-cols-[1fr_180px]"><NotesBlock invoice={invoice} /><SignatureBlock invoice={invoice} /></div>
      <UpiBlock upiValid={upiValid} qrUrl={qrUrl} />
      <Footer />
    </div>
  );
}

const DESIGN_COMPONENTS = {
  classic: ClassicDesign,
  modern: ModernDesign,
  minimal: MinimalDesign,
  executive: ExecutiveDesign,
  elegant: ElegantDesign,
};

export function InvoiceDesign({ design, ...model }) {
  const Component = DESIGN_COMPONENTS[design] || ClassicDesign;
  return <Component {...model} />;
}