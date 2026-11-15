import { AlertTriangle, CheckCircle2, Plus, Trash2 } from "lucide-react";
import { calculateInvoiceGlobalTax } from "@/global/tax/invoice-tax-integration.js";
import { getTaxInvoiceFormat } from "@/global/tax/tax-invoice-formats.js";

const fieldClass = "mt-1 w-full rounded-lg border bg-background px-3 py-2.5 text-sm";
const labelClass = "block text-xs font-semibold text-foreground";

export default function GlobalTaxEditor({ invoice, setInvoice, workspaceProfile, calculation }) {
  const countryCode = workspaceProfile?.countryCode || "";
  const format = getTaxInvoiceFormat(countryCode);
  const config = invoice.globalTax || {
    countryCode,
    mode: ["US", "CA"].includes(countryCode) ? "manual" : "automatic",
    priceMode: "exclusive",
    placeOfSupply: "",
    placeOfSupplyConfirmed: false,
    taxCategory: "",
    taxCategoryConfirmed: false,
    registrationConfirmed: false,
    collectionObligationAttested: false,
    destinationJurisdiction: { state: "", county: "", city: "", province: "" },
    components: [{ id: "manual-tax-1", name: "", rateBps: 0 }],
  };
  const selectedMode = ["US", "CA"].includes(countryCode) ? "manual" : (config.mode || "automatic");
  const update = (patch) => setInvoice((old) => ({
    ...old,
    globalTax: { ...config, mode: selectedMode, ...patch, countryCode },
  }));
  const updateJurisdiction = (key, value) => update({
    destinationJurisdiction: { ...(config.destinationJurisdiction || {}), [key]: value },
  });
  const updateComponent = (id, patch) => update({
    components: (config.components || []).map((item) => item.id === id ? { ...item, ...patch } : item),
  });
  const addComponent = () => {
    if ((config.components || []).length >= 8) return;
    update({ components: [...(config.components || []), { id: "manual-tax-" + Date.now(), name: "", rateBps: 0 }] });
  };
  const removeComponent = (id) => update({
    components: (config.components || []).filter((item) => item.id !== id),
  });
  const result = calculation || calculateInvoiceGlobalTax(invoice, workspaceProfile);
  const isUS = countryCode === "US";
  const isCA = countryCode === "CA";
  const currency = invoice.currency || workspaceProfile?.currencyCode || "";
  const manual = selectedMode === "manual";

  return (
    <section className="rounded-xl border bg-card p-4 sm:p-5" data-testid="global-tax-editor">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary/70">Global tax</p>
          <h3 className="mt-1 text-sm font-bold">{format?.title || "Tax invoice"} · {countryCode}</h3>
          <p className="mt-1 text-xs text-muted-foreground">Country-specific tax fields. Registration details are business-supplied and are not independently verified by Plivex.</p>
        </div>
        <span className="rounded-full bg-muted px-2 py-1 text-[10px] font-semibold">{currency}</span>
      </div>

      <div className="mt-3 rounded-lg bg-muted/40 p-3 text-[11px] text-muted-foreground">
        <p><strong>Saved registration:</strong> {workspaceProfile?.registrationNumber || "Not provided"} · {workspaceProfile?.registrationStatus || "unregistered"}</p>
        <p className="mt-1">Effective from: {workspaceProfile?.registrationEffectiveFrom || "Not provided"} · Registered jurisdiction: {workspaceProfile?.registeredJurisdiction || "Not provided"}</p>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>Calculation method
          <select className={fieldClass} value={selectedMode} onChange={(e) => update({ mode: e.target.value })}>
            {!isUS && !isCA && <option value="automatic">Automatic · verified standard rate</option>}
            <option value="manual">Manual · user-entered rate</option>
          </select>
        </label>
        <label className={labelClass}>Price includes tax?
          <select className={fieldClass} value={config.priceMode || "exclusive"} onChange={(e) => update({ priceMode: e.target.value })}>
            <option value="exclusive">No · add tax to entered price</option>
            <option value="inclusive">Yes · tax is included in entered price</option>
          </select>
        </label>
        <label className={labelClass}>Place of supply
          <input className={fieldClass} maxLength={180} value={config.placeOfSupply || ""} onChange={(e) => update({ placeOfSupply: e.target.value, placeOfSupplyConfirmed: false })} placeholder="Destination / place where supply is made" />
        </label>
        <label className={labelClass}>{format?.classificationLabel || "Goods/services tax category"}
          <select className={fieldClass} value={config.taxCategory || ""} onChange={(e) => update({ taxCategory: e.target.value, taxCategoryConfirmed: false })}>
            <option value="">Select supported treatment</option>
            <option value="standard-rated">Standard-rated taxable supply</option>
          </select>
        </label>
      </div>

      <div className="mt-3 grid gap-2 rounded-lg bg-muted/40 p-3 text-xs">
        <label className="flex items-start gap-2"><input type="checkbox" checked={config.registrationConfirmed === true} onChange={(e) => update({ registrationConfirmed: e.target.checked })} /><span>I confirm the saved registration number, status and effective date are accurate and active for this invoice.</span></label>
        <label className="flex items-start gap-2"><input type="checkbox" checked={config.placeOfSupplyConfirmed === true} onChange={(e) => update({ placeOfSupplyConfirmed: e.target.checked })} /><span>I confirm the place of supply entered above.</span></label>
        <label className="flex items-start gap-2"><input type="checkbox" checked={config.taxCategoryConfirmed === true} onChange={(e) => update({ taxCategoryConfirmed: e.target.checked })} /><span>I confirm the goods/services tax category entered above.</span></label>
      </div>

      {(isUS || isCA) && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
          <p className="font-bold">Jurisdiction-specific rates are not auto-filled.</p>
          <p className="mt-1">A verified address-level rate and nexus provider is not configured. Plivex will not guess US state/county/city or Canadian province rates. Manual rates are user-entered and unverified; the attestation is not independent verification.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {isUS ? <>
              <label className={labelClass}>Destination state code<input className={fieldClass} maxLength={8} value={config.destinationJurisdiction?.state || ""} onChange={(e) => updateJurisdiction("state", e.target.value.toUpperCase())} placeholder="e.g. CA" /></label>
              <label className={labelClass}>Destination county<input className={fieldClass} maxLength={100} value={config.destinationJurisdiction?.county || ""} onChange={(e) => updateJurisdiction("county", e.target.value)} /></label>
              <label className={labelClass}>Destination city<input className={fieldClass} maxLength={100} value={config.destinationJurisdiction?.city || ""} onChange={(e) => updateJurisdiction("city", e.target.value)} /></label>
            </> : <>
              <label className={labelClass}>Destination province / territory code<input className={fieldClass} maxLength={8} value={config.destinationJurisdiction?.province || ""} onChange={(e) => updateJurisdiction("province", e.target.value.toUpperCase())} placeholder="e.g. ON" /></label>
            </>}
            <label className={labelClass}>{isUS ? "Seller registered state / jurisdiction" : "Seller registered province / jurisdiction"}
              <input className={fieldClass} value={workspaceProfile?.registeredJurisdiction || ""} readOnly />
            </label>
          </div>
          <label className="mt-3 flex items-start gap-2"><input type="checkbox" checked={config.collectionObligationAttested === true} onChange={(e) => update({ collectionObligationAttested: e.target.checked })} /><span>I attest that I have checked whether this business must collect tax in this destination jurisdiction. Plivex does not independently verify nexus or collection obligations.</span></label>
        </div>
      )}

      {manual && (
        <div className="mt-4 rounded-lg border p-3">
          <div className="flex items-center justify-between gap-2">
            <div><p className="text-xs font-bold">Manual tax components</p><p className="mt-1 text-[11px] text-muted-foreground">Enter rates only after checking applicable official rules. Zero-rated/exempt treatments are not supported by this manual calculator.</p></div>
            <button type="button" onClick={addComponent} disabled={(config.components || []).length >= 8} className="inline-flex items-center gap-1 rounded-md border px-2 py-1.5 text-[11px] font-semibold disabled:opacity-40"><Plus className="h-3 w-3" />Add</button>
          </div>
          <div className="mt-3 space-y-2">
            {(config.components || []).map((component) => (
              <div key={component.id} className="grid grid-cols-[minmax(0,1fr)_100px_32px] items-end gap-2">
                <label className={labelClass}>Component name<input className={fieldClass} maxLength={60} value={component.name || ""} onChange={(e) => updateComponent(component.id, { name: e.target.value })} placeholder={isUS ? "State / County / City / District" : isCA ? "GST / HST / PST / QST" : format?.taxLabel || "Tax"} /></label>
                <label className={labelClass}>Rate (%)<input className={fieldClass} type="number" min="0.01" max="100" step="0.01" value={(Number(component.rateBps || 0) / 100).toString()} onChange={(e) => updateComponent(component.id, { rateBps: Math.round(Number(e.target.value) * 100) })} /></label>
                <button type="button" onClick={() => removeComponent(component.id)} disabled={(config.components || []).length <= 1} className="mb-1 rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30" aria-label="Remove tax component"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 rounded-lg border p-3" aria-live="polite">
        {result?.ok ? (
          <>
            <p className="flex items-center gap-2 text-xs font-bold text-emerald-700"><CheckCircle2 className="h-4 w-4" />{result.status === "manual_unverified" ? "Manual calculation · unverified" : "Standard-rate calculation"}</p>
            <p className="mt-2 text-sm font-semibold">Tax: {(result.taxMinor / 100).toFixed(2)} {currency} · Total: {(result.totalMinor / 100).toFixed(2)} {currency}</p>
            {result.warning && <p className="mt-2 text-[11px] leading-relaxed text-amber-800">{result.warning}</p>}
            {result.ruleSnapshot?.source && <a className="mt-2 inline-block text-[11px] text-primary underline" href={result.ruleSnapshot.source} target="_blank" rel="noreferrer">View tax rule source</a>}
          </>
        ) : (
          <p className="flex items-start gap-2 text-xs text-amber-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{result?.message || "Complete the required tax details to calculate this invoice."}</p>
        )}
      </div>
    </section>
  );
}
