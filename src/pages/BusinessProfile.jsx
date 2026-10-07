import { Store, ImagePlus, Check } from "lucide-react";
import PageShell from "@/components/PageShell";
import { KEYS, useLocalState } from "@/lib/stores";
import { backend as db } from "@/api/backendClient";
import { inputCls } from "@/lib/ui";

const defaults = { name: "", address: "", gstin: "", email: "", phone: "", logo: "", upiId: "" };

function Field({ label, children }) {
  return <label className="block text-[12px] font-semibold text-muted-foreground">{label}{children}</label>;
}

export default function BusinessProfile() {
  const [profile, setProfile] = useLocalState(KEYS.businessProfile, defaults);
  const set = (k, v) => setProfile((p) => ({ ...p, [k]: v }));
  // The logo is resized to a small image before it is saved with the business profile.
  const onLogo = async (e) => { const f = e.target.files?.[0]; if (!f) return; try { const { file_url } = await db.integrations.Core.UploadFile({ file: f }); set("logo", file_url); } catch { /* not an image */ } };

  return (
    <PageShell icon={Store} title="Business profile" subtitle="Saved defaults pulled in when you start a new invoice.">
      <div className="grid gap-5 lg:grid-cols-[1fr_240px]">
        <div className="space-y-4 rounded-xl border bg-card p-5">
          <Field label="Business name"><input className={inputCls} value={profile.name} onChange={(e) => set("name", e.target.value)} placeholder="Your Business Name" /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="GSTIN"><input className={inputCls} value={profile.gstin} onChange={(e) => set("gstin", e.target.value)} placeholder="22AAAAA0000A1Z5" /></Field>
            <Field label="Email"><input className={inputCls} value={profile.email} onChange={(e) => set("email", e.target.value)} placeholder="you@studio.in" /></Field>
            <Field label="Phone"><input className={inputCls} value={profile.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+91" /></Field>
            <Field label="UPI ID / VPA"><input className={inputCls} value={profile.upiId || ""} onChange={(e) => set("upiId", e.target.value)} placeholder="store@upi" /></Field>
          </div>
          <Field label="Address"><textarea className={`${inputCls} min-h-[80px]`} value={profile.address} onChange={(e) => set("address", e.target.value)} placeholder="Registered business address" /></Field>
          <p className="flex items-center gap-1.5 text-[11px] text-emerald-600"><Check className="h-3.5 w-3.5" />Changes save automatically</p>
        </div>
        <div className="rounded-xl border bg-card p-5">
          <p className="text-[12px] font-semibold text-muted-foreground">Default logo</p>
          <div className="mt-3 flex h-[140px] items-center justify-center overflow-hidden rounded-lg border border-dashed bg-background">
            {profile.logo ? <img src={profile.logo} alt="Logo" className="h-full w-full object-contain" /> : <span className="text-[11px] text-muted-foreground">No logo</span>}
          </div>
          <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 py-2 text-[11px] font-semibold hover:bg-secondary"><ImagePlus className="h-3.5 w-3.5" />{profile.logo ? "Replace logo" : "Upload logo"}<input type="file" accept="image/png,image/jpeg" className="hidden" onChange={onLogo} /></label>
          {profile.logo && <button onClick={() => set("logo", "")} className="mt-2 w-full text-[11px] font-semibold text-destructive hover:underline">Remove logo</button>}
        </div>
      </div>
    </PageShell>
  );
}