import { LifeBuoy, Phone, Mail } from "lucide-react";
import PageShell from "@/components/PageShell";

const guides = [
  { title: "Add your business details", body: "Open the invoice desk and fill Your business — name, GSTIN, email and phone. These appear in the header of every invoice you send." },
  { title: "Fill client information", body: "Under Client details, enter the client name (required), company and address. A valid phone here lets you share the invoice straight to WhatsApp." },
  { title: "Add line items", body: "Each line needs a description and a rate. Set the per-line GST rate from the dropdown; quantity multiplies the rate into the line amount automatically." },
  { title: "Apply discount & tax", body: "Pick a default GST rate and choose CGST+SGST or IGST. Discounts can be a percentage or a flat amount and reduce the taxable subtotal." },
  { title: "Add a UPI QR code", body: "Enter your UPI ID/VPA in Invoice settings. A scannable QR renders on the invoice and PDF so clients can pay instantly." },
  { title: "Download & share", body: "Use Download PDF for a print-ready A4 file, or Send via WhatsApp to share a link with the client. You get 3 free exports — upgrade for unlimited." },
];

export default function HelpCenter() {
  return (
    <PageShell icon={LifeBuoy} title="Help center" subtitle="Step-by-step guides to breeze through your billing.">
      <div className="grid gap-3 sm:grid-cols-2">
        {guides.map((g, i) => (
          <div key={g.title} className="rounded-xl border bg-card p-4">
            <div className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{i + 1}</span><p className="text-[13px] font-bold">{g.title}</p></div>
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">{g.body}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <a href="tel:9758455218" className="flex items-center gap-3 rounded-xl border bg-card p-4 hover:bg-secondary"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Phone className="h-5 w-5" /></span><div><p className="text-[11px] text-muted-foreground">Call support</p><p className="text-[14px] font-bold">9758455218</p></div></a>
        <a href="mailto:plivex.helps@gmail.com" className="flex items-center gap-3 rounded-xl border bg-card p-4 hover:bg-secondary"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-primary"><Mail className="h-5 w-5" /></span><div><p className="text-[11px] text-muted-foreground">Email support</p><p className="text-[14px] font-bold">plivex.helps@gmail.com</p></div></a>
      </div>
    </PageShell>
  );
}