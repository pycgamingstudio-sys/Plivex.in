import { LifeBuoy, Phone, Mail } from "lucide-react";
import PageShell from "@/components/PageShell";
import { APP_EDITION } from "@/api/backendClient";
import { useAuth } from "@/lib/AuthContext";
import { getCountryExperience } from "@/global/countries/country-experience.js";

const guides = [
  { title: "Add your business details", body: "Open the invoice desk and fill Your business — name, GSTIN, email and phone. These appear in the header of every invoice you send." },
  { title: "Fill client information", body: "Under Client details, enter the client name (required), company and address. A valid phone here lets you share the invoice straight to WhatsApp." },
  { title: "Add line items", body: "Each line needs a description and a rate. Set the per-line GST rate from the dropdown; quantity multiplies the rate into the line amount automatically." },
  { title: "Apply discount & tax", body: "Pick a default GST rate and choose CGST+SGST or IGST. Discounts can be a percentage or a flat amount and reduce the taxable subtotal." },
  { title: "Add a UPI QR code", body: "Enter your UPI ID/VPA in Invoice settings. A scannable QR renders on the invoice and PDF so clients can pay instantly." },
  { title: "Download & share", body: "Use Download PDF for a print-ready A4 file, or Send via WhatsApp to share a link with the client. You get 3 free exports — upgrade for unlimited." },
];

export default function HelpCenter() {
  const { user } = useAuth();
  const experience = getCountryExperience(user?.country_code);
  const activeGuides = APP_EDITION === "global" ? [
    { title: "Set up your business profile", body: `Add your ${experience?.countryName || "local"} business name, address, contact details and applicable tax registration information. Registration is business-supplied and is not verified by Plivex.` },
    { title: "Create a local invoice", body: `Your workspace uses ${experience?.currencyCode || "the configured"} currency and regional format. Complete the seller, customer, line-item and payment details before saving.` },
    { title: "Review tax before issuing", body: `The tax section shows the capability available for ${experience?.countryName || "your country"}. Do not treat a country selection or manual rate as proof of tax registration or legal compliance.` },
    { title: "Manage customers and records", body: "Save customer contact and tax-registration details where applicable. Workspace records are kept separate from other businesses." },
    { title: "Download and share invoices", body: "Download the invoice PDF and use the available share options. Review the final document before sending it to your customer." },
  ] : guides;
  return (
    <PageShell icon={LifeBuoy} title="Help center" subtitle={APP_EDITION === "global" ? `Guides for your ${experience?.countryName || "regional"} workspace.` : "Step-by-step guides to breeze through your billing."}>
      <div className="grid gap-3 sm:grid-cols-2">
        {activeGuides.map((g, i) => (
          <div key={g.title} className="rounded-xl border bg-card p-4">
            <div className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{i + 1}</span><p className="text-[13px] font-bold">{g.title}</p></div>
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">{g.body}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {APP_EDITION !== "global" && <a href="tel:9758455218" className="flex items-center gap-3 rounded-xl border bg-card p-4 hover:bg-secondary"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Phone className="h-5 w-5" /></span><div><p className="text-[11px] text-muted-foreground">Call support</p><p className="text-[14px] font-bold">9758455218</p></div></a>}
        <a href="mailto:support@plivex.in" className="flex items-center gap-3 rounded-xl border bg-card p-4 hover:bg-secondary"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-primary"><Mail className="h-5 w-5" /></span><div><p className="text-[11px] text-muted-foreground">Email support</p><p className="text-[14px] font-bold">support@plivex.in</p></div></a>
      </div>
    </PageShell>
  );
}