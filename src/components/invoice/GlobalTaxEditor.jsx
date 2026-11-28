import { AlertTriangle, CheckCircle2, Plus, Trash2 } from "lucide-react";
import { calculateInvoiceGlobalTax } from "@/global/tax/invoice-tax-integration.js";
import { parseIndianGstin } from "@/global/tax/gstin.js";
import { getTaxInvoiceFormat } from "@/global/tax/tax-invoice-formats.js";

const fieldClass = "mt-1 w-full rounded-lg border bg-background px-3 py-2.5 text-sm";
const labelClass = "block text-xs font-semibold text-foreground";
const INDIA_PLACES = [
  ["01","Jammu and Kashmir"],["02","Himachal Pradesh"],["03","Punjab"],["04","Chandigarh"],
  ["05","Uttarakhand"],["06","Haryana"],["07","Delhi"],["08","Rajasthan"],["09","Uttar Pradesh"],
  ["10","Bihar"],["11","Sikkim"],["12","Arunachal Pradesh"],["13","Nagaland"],["14","Manipur"],
  ["15","Mizoram"],["16","Tripura"],["17","Meghalaya"],["18","Assam"],["19","West Bengal"],
  ["20","Jharkhand"],["21","Odisha"],["22","Chhattisgarh"],["23","Madhya Pradesh"],
  ["24","Gujarat"],["26","Dadra and Nagar Haveli and Daman and Diu"],["27","Maharashtra"],
  ["28","Andhra Pradesh (legacy)"],["29","Karnataka"],["30","Goa"],["31","Lakshadweep"],
  ["32","Kerala"],["33","Tamil Nadu"],["34","Puducherry"],["35","Andaman and Nicobar Islands"],
  ["36","Telangana"],["37","Andhra Pradesh"],["38","Ladakh"],["97","Other Territory"],
];

export default function GlobalTaxEditor({ invoice, setInvoice, workspaceProfile, calculation, allowNoTax = true, serverResolved = false }) {
  const countryCode = workspaceProfile?.countryCode || "";
  const format = getTaxInvoiceFormat(countryCode);
  const gstinInfo = countryCode === "IN" ? parseIndianGstin(workspaceProfile?.registrationNumber || "") : null;
  const config = {
    countryCode,
    mode: countryCode === "US" ? "manual" : "automatic",
    taxMode: String(workspaceProfile?.registrationStatus || "unregistered").trim().toLowerCase() === "unregistered" ? "no_tax" : "taxable",
      noTaxConfirmed: false,
      priceMode: "exclusive",
      indiaSupplyType: "INTRA",
      taxCode: "GST_18",
      placeOfSupply: "",
      placeOfSupplyConfirmed: false,
      taxCategory: "",
      taxCategoryConfirmed: false,
      registrationConfirmed: false,
      collectionObligationAttested: false,
      destinationJurisdiction: { state: "", county: "", city: "", province: "" },
      components: [{ id: "manual-tax-1", name: "", rateBps: 0 }],
    ...(invoice.globalTax || {}),
    taxDetailsConfirmed: invoice.globalTax?.taxDetailsConfirmed === true,
  };
  const selectedMode = serverResolved ? "automatic" : (countryCode === "US" ? "manual" : (config.mode || "automatic"));
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
  const result = serverResolved ? { ok:false, message:"Supabase resolves the effective Workspace-country rule when you save this invoice draft." } : (calculation || calculateInvoiceGlobalTax(invoice, workspaceProfile));
  const isUS = countryCode === "US";
  const isCA = countryCode === "CA";
  const currency = invoice.currency || workspaceProfile?.currencyCode || "";
  const manual = !serverResolved && selectedMode === "manual" && config.taxMode !== "no_tax";
  const noTax = allowNoTax && config.taxMode === "no_tax";

  return (
    <section className="rounded-xl border bg-card p-4 sm:p-5" data-testid="global-tax-editor">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary/70">Global tax</p>
          <h3 className="mt-1 text-sm font-bold">{noTax ? "Commercial invoice" : (format?.title || "Tax invoice")} · {countryCode}</h3>
          <p className="mt-1 text-xs text-muted-foreground">Country-specific tax preview. Registration details are business-supplied and are not independently verified by Plivex.</p>
        </div>
        <span className="rounded-full bg-muted px-2 py-1 text-[10px] font-semibold">{currency}</span>
      </div>

      <div className="mt-3 rounded-lg bg-muted/40 p-3 text-[11px] text-muted-foreground"><strong>Choose the correct document:</strong> Unregistered businesses can prepare a commercial invoice when they are not required to charge this tax. Confirm the rules for this transaction before issuing. Plivex does not independently verify registration or tax obligations.</div>
      <label className={labelClass + " mt-4"}>How should tax be handled?
        <select data-testid="global-tax-mode" className={fieldClass} value={noTax ? "no_tax" : "taxable"} onChange={(e) => update({ taxMode: e.target.value, noTaxConfirmed: false })}>
          <option value="taxable">Tax applies · calculate tax</option>
          {allowNoTax && <option value="no_tax">No tax charged · commercial invoice</option>}
        </select>
      </label>
      {noTax ? (
        <div className="mt-3 rounded-lg border p-3 text-xs">
          <label className="flex items-start gap-2"><input data-testid="global-no-tax-confirm" type="checkbox" checked={config.noTaxConfirmed === true} onChange={(e) => update({ noTaxConfirmed: e.target.checked })} /><span>I confirm that I have checked the rules for this business and this transaction, and I am not required to charge this country’s tax. I understand this is a commercial invoice, not a tax invoice, and this is not a zero-rated or tax-exempt classification.</span></label>
          <p className="mt-2 text-[11px] text-muted-foreground">Your issued document will be titled Commercial Invoice, will not show a tax registration number as if one were required, and will clearly state that tax was not assessed by Plivex. If you are required to register or collect tax, switch to “Tax applies” and complete the tax details instead. Plivex does not decide whether your business or transaction legally qualifies.</p>
        </div>
      ) : (
      <>
      <div className="mt-3 rounded-lg bg-muted/40 p-3 text-[11px] text-muted-foreground">
        <p><strong>Saved registration:</strong> {workspaceProfile?.registrationNumber || "Not provided"} · {workspaceProfile?.registrationStatus || "unregistered"}</p>
        <p className="mt-1">Effective from: {workspaceProfile?.registrationEffectiveFrom || "Not provided"} · Registered jurisdiction: {workspaceProfile?.registeredJurisdiction || "Not provided"}</p>
        {countryCode === "IN" && gstinInfo?.ok && <p className="mt-1 text-emerald-700">GSTIN format recognized · State code {gstinInfo.stateCode}: {gstinInfo.stateName}. Format check only; government registration status is not verified.</p>}
        {countryCode === "IN" && workspaceProfile?.registrationNumber && !gstinInfo?.ok && <p className="mt-1 text-amber-700">Saved GSTIN does not match the expected 15-character format. Please review the saved value.</p>}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {countryCode === "IN" && <label className={labelClass}>GST rate
          <select className={fieldClass} value={config.taxCode || "GST_18"} onChange={(e) => update({ taxCode: e.target.value, taxTreatment: e.target.value === "GST_0" ? "zero-rated" : e.target.value === "GST_5" ? "reduced" : "standard", taxDetailsConfirmed: false })}>
            {[["GST_0","0%"],["GST_5","5%"],["GST_12","12%"],["GST_18","18%"],["GST_28","28%"]].map(([value,label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>}
        {countryCode === "IN" && <label className={labelClass}>GST supply type
          <select className={fieldClass} value={config.indiaSupplyType || "INTRA"} onChange={(e) => update({ indiaSupplyType: e.target.value })}>
            <option value="INTRA">Same state · CGST + SGST</option>
            <option value="INTER">Different state · IGST</option>
          </select>
        </label>}
        {!serverResolved && <label className={labelClass}>Calculation method
          <select className={fieldClass} value={selectedMode} onChange={(e) => update({ mode: e.target.value })}>
            {!isUS && <option value="automatic">Automatic · source-backed country rate</option>}
            <option value="manual">Manual · user-entered rate</option>
          </select>
        </label>}
        {serverResolved && <p className="text-xs text-muted-foreground">Rule source: Supabase Workspace tax registry · resolved on save</p>}
        <label className={labelClass}>Price includes tax?
          <select className={fieldClass} value={config.priceMode || "exclusive"} onChange={(e) => update({ priceMode: e.target.value })}>
            <option value="exclusive">No · add tax to entered price</option>
            <option value="inclusive">Yes · tax is included in entered price</option>
          </select>
        </label>
        <label className={labelClass}>Place of supply
          {countryCode === "IN" ? (
            <select data-testid="india-place-of-supply" className={fieldClass} value={config.placeOfSupply || ""} onChange={(e) => update({ placeOfSupply: e.target.value, placeOfSupplyConfirmed: false })}>
              <option value="">Select state / UT code</option>
              {INDIA_PLACES.map(([code,name]) => <option key={code} value={code}>{code} · {name}</option>)}
            </select>
          ) : countryCode === "GB" ? (
            <select className={fieldClass} value={config.placeOfSupply || ""} onChange={(e) => update({ placeOfSupply: e.target.value, placeOfSupplyConfirmed: false })}>
              <option value="">Select place of supply</option>
              <option value="United Kingdom">United Kingdom</option>
            </select>
          ) : (
            <input className={fieldClass} maxLength={180} value={config.placeOfSupply || ""} onChange={(e) => update({ placeOfSupply: e.target.value, placeOfSupplyConfirmed: false })} placeholder="Destination / place where supply is made" />
          )}
        </label>
        <label className={labelClass}>Tax treatment
          <select className={fieldClass} value={config.taxTreatment || "standard"} onChange={(e) => update({ taxTreatment: e.target.value, taxCategory: "", taxCategoryConfirmed: false, taxDetailsConfirmed: false })}>
            <option value="standard">Standard-rated</option>
            {["AE","SG","CA"].includes(countryCode) && <option value="zero-rated">Zero-rated · 0%</option>}{countryCode === "GB" && <option value="reduced">Reduced-rated · 5%</option>}{countryCode === "AU" && <option value="gst-free">GST-free · 0%</option>}{countryCode === "CA" && <option value="zero-rated">Zero-rated · 0%</option>}
            {["AE","AU","SG"].includes(countryCode) && <option value="exempt">Exempt · no tax charged</option>}
            {countryCode === "SG" && <option value="out-of-scope">Out of scope</option>}
          </select>
        </label>
        <label className={labelClass}>{format?.classificationLabel || "Goods/services tax category"}
          <select className={fieldClass} value={config.taxCategory || ""} onChange={(e) => update({ taxCategory: e.target.value, taxCategoryConfirmed: false })}>
            <option value="">Select supported treatment</option>
            <option value="standard-rated">Standard-rated taxable supply</option>
            {countryCode === "AE" && config.taxTreatment === "zero-rated" && <option value="AE_ZERO_RATED_EXPORTS">Qualifying exports outside GCC</option>}
            {countryCode === "AE" && config.taxTreatment === "exempt" && <option value="AE_EXEMPT_FINANCIAL_SERVICES">Qualifying financial services</option>}
            {countryCode === "AU" && config.taxTreatment === "gst-free" && <option value="AU_GST_FREE_BASIC_FOOD">Qualifying basic food</option>}{countryCode === "CA" && config.taxTreatment === "zero-rated" && <option value="CA_ZERO_RATED_BASIC_GROCERIES">Qualifying basic groceries</option>}
            {countryCode === "AU" && config.taxTreatment === "exempt" && <option value="AU_INPUT_TAXED_FINANCIAL_SERVICES">Qualifying input-taxed financial services</option>}
            {countryCode === "SG" && config.taxTreatment === "zero-rated" && <option value="SG_ZERO_RATED_EXPORTS_INTERNATIONAL_SERVICES">Qualifying exports / international services</option>}
            {countryCode === "SG" && config.taxTreatment === "exempt" && <option value="SG_EXEMPT_FINANCIAL_SERVICES">Qualifying exempt financial services</option>}
            {countryCode === "SG" && config.taxTreatment === "out-of-scope" && <option value="SG_OUT_OF_SCOPE_OVERSEAS_TO_OVERSEAS_GOODS">Goods delivered overseas to overseas</option>}
          </select>
        </label>
      </div>

      <div className="mt-3 rounded-lg bg-muted/40 p-3 text-xs">
        <label className="flex min-h-11 cursor-pointer items-start gap-3">
          <input
            data-testid="global-tax-details-confirm"
            className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-primary"
            type="checkbox"
            checked={config.taxDetailsConfirmed === true}
            onChange={(e) => update({
              taxDetailsConfirmed: e.target.checked,
              registrationConfirmed: e.target.checked,
              placeOfSupplyConfirmed: e.target.checked,
              taxCategoryConfirmed: e.target.checked,
            })}
          />
          <span className="leading-relaxed">I confirm the saved registration details and the invoice's place of supply and tax category are accurate for this transaction.</span>
        </label>
      </div>

      {(isUS || isCA) && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
          <p className="font-bold">{serverResolved ? "Destination jurisdiction required." : "Jurisdiction-specific rates are not auto-filled."}</p>
          <p className="mt-1">{serverResolved
            ? (isUS ? "The Supabase baseline resolves the selected state only; local city, county and special-district taxes are not included." : "The Supabase baseline combines applicable provincial GST/HST/PST/QST rows. Product-specific exceptions may still apply.")
            : "US state/local rates still require exact address-level rules. Canadian provincial baseline rates are selected by province; product-specific PST exceptions and Quebec QST precision remain review-only. Manual rates are user-entered and unverified."}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {isUS ? <>
              <label className={labelClass}>Destination state code<input className={fieldClass} maxLength={8} value={config.destinationJurisdiction?.state || ""} onChange={(e) => updateJurisdiction("state", e.target.value.toUpperCase())} placeholder="e.g. CA" /></label>
              <label className={labelClass}>Destination county<input className={fieldClass} maxLength={100} value={config.destinationJurisdiction?.county || ""} onChange={(e) => updateJurisdiction("county", e.target.value)} /></label>
              <label className={labelClass}>Destination city<input className={fieldClass} maxLength={100} value={config.destinationJurisdiction?.city || ""} onChange={(e) => updateJurisdiction("city", e.target.value)} /></label>
            </> : <>
              <label className={labelClass}>Destination province / territory code<select className={fieldClass} value={config.destinationJurisdiction?.province || ""} onChange={(e) => updateJurisdiction("province", e.target.value)}>
                <option value="">Select province / territory</option>
                {["AB","BC","MB","NB","NL","NS","NT","NU","ON","PE","QC","SK","YT"].map((code) => <option key={code} value={code}>{code}</option>)}
              </select></label>
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

      </>
      )}
      <div className="mt-4 rounded-lg border p-3" aria-live="polite">
        {result?.ok ? (
          <>
            <p className="flex items-center gap-2 text-xs font-bold text-emerald-700"><CheckCircle2 className="h-4 w-4" />{result.status === "not_applicable" ? "No tax charged · commercial invoice" : result.status === "manual_unverified" ? "Manual calculation · unverified" : "Verified tax treatment calculation"}</p>
            <p className="mt-2 text-sm font-semibold">Tax: {(result.taxMinor / 100).toFixed(2)} {currency} · Total: {(result.totalMinor / 100).toFixed(2)} {currency}</p>
            {(result.warning || result.disclosure) && <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{result.warning || result.disclosure}</p>}
            {result.ruleSnapshot?.source && <a className="mt-2 inline-block text-[11px] text-primary underline" href={result.ruleSnapshot.source} target="_blank" rel="noreferrer">View tax rule source</a>}
          </>
        ) : (
          <p className="flex items-start gap-2 text-xs text-amber-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{result?.message || "Complete the required tax details to calculate this invoice."}</p>
        )}
      </div>
    </section>
  );
}
