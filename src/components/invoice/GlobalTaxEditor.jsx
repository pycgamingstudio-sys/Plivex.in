import { AlertTriangle, CheckCircle2, Plus, Trash2 } from "lucide-react";
import { calculateInvoiceGlobalTax } from "@/global/tax/invoice-tax-integration.js";
import { getTaxInvoiceFormat } from "@/global/tax/tax-invoice-formats.js";

const fieldClass = "mt-1 w-full rounded-lg border bg-background px-3 py-2.5 text-sm";
const labelClass = "block text-xs font-semibold text-foreground";

export default function GlobalTaxEditor({ invoice, setInvoice, workspaceProfile, calculation, allowNoTax = true }) {
  const countryCode = workspaceProfile?.countryCode || "";
  const format = getTaxInvoiceFormat(countryCode);
  const config = {
    ...(invoice.globalTax || {
      countryCode,
      mode: countryCode === "US" ? "manual" : "automatic",
      taxMode: "taxable",
      noTaxConfirmed: false,
      priceMode: "exclusive",
      placeOfSupply: "",
      placeOfSupplyConfirmed: false,
      taxCategory: "",
      taxCategoryConfirmed: false,
      registrationConfirmed: false,
      collectionObligationAttested: false,
      destinationJurisdiction: { state: "", county: "", city: "", province: "" },
      components: [{ id: "manual-tax-1", name: "", rateBps: 0 }],
    }),
    taxDetailsConfirmed: invoice.globalTax?.taxDetailsConfirmed === true,
  };
  const selectedMode = countryCode === "US" ? "manual" : (config.mode || "automatic");
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
  const manual = selectedMode === "manual" && config.taxMode !== "no_tax";
  const noTax = allowNoTax && config.taxMode === "no_tax";

  return (
    <section className="rounded-xl border bg-card p-4 sm:p-5" data-testid="global-tax-editor">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary/70">Global tax</p>
          <h3 className="mt-1 text-sm font-bold">{format?.title || "Tax invoice"} · {countryCode}</h3>
          <p className="mt-1 text-xs text-muted-foreground">Country-specific tax preview. Registration details are business-supplied and are not independently verified by Plivex.</p>
        </div>
        <span className="rounded-full bg-muted px-2 py-1 text-[10px] font-semibold">{currency}</span>
      </div>

      <div className="mt-3 rounded-lg bg-muted/40 p-3 text-[11px] text-muted-foreground"><strong>Tax treatment:</strong> Plivex records the choice you make here. It does not independently verify registration, tax obligations or exemptions.</div>
      <label className={labelClass + " mt-4"}>How should tax be handled?
        <select data-testid="global-tax-mode" className={fieldClass} value={noTax ? "no_tax" : "taxable"} onChange={(e) => update({ taxMode: e.target.value, noTaxConfirmed: false })}>
          <option value="taxable">Tax applies · calculate tax</option>
          {allowNoTax && <option value="no_tax">No tax charged · commercial invoice</option>}
        </select>
      </label>
      {noTax ? (
        <div className="mt-3 rounded-lg border p-3 text-xs">
          <label className="flex items-start gap-2"><input data-testid="global-no-tax-confirm" type="checkbox" checked={config.noTaxConfirmed === true} onChange={(e) => update({ noTaxConfirmed: e.target.checked })} /><span>I confirm that I have checked the rules for this business and transaction and am not required to charge this tax. I understand this is not a zero-rated or tax-exempt classification.</span></label>
          <p className="mt-2 text-[11px] text-muted-foreground">The invoice will show no tax added. Plivex does not decide whether your business or transaction legally qualifies.</p>
        </div>
      ) : (
      <>
      <div className="mt-3 rounded-lg bg-muted/40 p-3 text-[11px] text-muted-foreground">
        <p><strong>Saved registration:</strong> {workspaceProfile?.registrationNumber || "Not provided"} · {workspaceProfile?.registrationStatus || "unregistered"}</p>
        <p className="mt-1">Effective from: {workspaceProfile?.registrationEffectiveFrom || "Not provided"} · Registered jurisdiction: {workspaceProfile?.registeredJurisdiction || "Not provided"}</p>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>Calculation method
          <select className={fieldClass} value={selectedMode} onChange={(e) => update({ mode: e.target.value })}>
            {!isUS && <option value="automatic">Automatic · source-backed country rate</option>}
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
          {["GB","AE","AU","SG"].includes(countryCode) ? (
            <select className={fieldClass} value={config.placeOfSupply || ""} onChange={(e) => update({ placeOfSupply: e.target.value, placeOfSupplyConfirmed: false })}>
              <option value="">Select place of supply</option>
              {countryCode === "GB" && <option value="United Kingdom">United Kingdom</option>}
              {countryCode === "AE" && <option value="United Arab Emirates">United Arab Emirates</option>}
              {countryCode === "AU" && <option value="Australia">Australia</option>}
              {countryCode === "SG" && <option value="Singapore">Singapore</option>}
            </select>
          ) : (
            <input className={fieldClass} maxLength={180} value={config.placeOfSupply || ""} onChange={(e) => update({ placeOfSupply: e.target.value, placeOfSupplyConfirmed: false })} placeholder="Destination / place where supply is made" />
          )}
        </label>
        <label className={labelClass}>Tax treatment
          <select className={fieldClass} value={config.taxTreatment || "standard"} onChange={(e) => update({ taxTreatment: e.target.value, taxCategory: "", taxCategoryConfirmed: false, taxDetailsConfirmed: false, ...(e.target.value === "reverse-charge" ? { priceMode: "exclusive" } : {}) })}>
            <option value="standard">Standard-rated</option>
            {["AE","SG","CA"].includes(countryCode) && <option value="zero-rated">Zero-rated · 0%</option>}{countryCode === "GB" && <option value="reduced">Reduced-rated · 5%</option>}{countryCode === "GB" && <option value="reverse-charge">Reverse charge · buyer accounts for tax</option>}{countryCode === "AU" && <option value="gst-free">GST-free · 0%</option>}{countryCode === "CA" && <option value="zero-rated">Zero-rated · 0%</option>}
            {["AE","AU","SG"].includes(countryCode) && <option value="exempt">Exempt · no tax charged</option>}
            {countryCode === "SG" && <option value="out-of-scope">Out of scope</option>}
          </select>
        </label>
        <label className={labelClass}>{format?.classificationLabel || "Goods/services tax category"}
          <select className={fieldClass} value={config.taxCategory || ""} onChange={(e) => update({ taxCategory: e.target.value, taxCategoryConfirmed: false })}>
            <option value="">Select supported treatment</option>
            <option value="standard-rated">Standard-rated taxable supply</option>
            {countryCode === "CA" && ["BC", "MB", "SK"].includes(String(config.destinationJurisdiction?.province || "").toUpperCase()) && <option value={`CA_${String(config.destinationJurisdiction.province).toUpperCase()}_PST_TAXABLE_GOODS`}>Taxable tangible goods subject to provincial PST/RST</option>}
            {countryCode === "AE" && config.taxTreatment === "zero-rated" && <option value="AE_ZERO_RATED_EXPORTS">Qualifying exports outside GCC</option>}
            {countryCode === "AE" && config.taxTreatment === "exempt" && <option value="AE_EXEMPT_FINANCIAL_SERVICES">Qualifying financial services</option>}
            {countryCode === "AU" && config.taxTreatment === "gst-free" && <option value="AU_GST_FREE_BASIC_FOOD">Qualifying basic food</option>}{countryCode === "CA" && config.taxTreatment === "zero-rated" && <option value="CA_ZERO_RATED_BASIC_GROCERIES">Qualifying basic groceries</option>}
            {countryCode === "AU" && config.taxTreatment === "exempt" && <option value="AU_INPUT_TAXED_FINANCIAL_SERVICES">Qualifying input-taxed financial services</option>}
            {countryCode === "SG" && config.taxTreatment === "zero-rated" && <option value="SG_ZERO_RATED_EXPORTS_INTERNATIONAL_SERVICES">Qualifying exports / international services</option>}
            {countryCode === "SG" && config.taxTreatment === "exempt" && <option value="SG_EXEMPT_FINANCIAL_SERVICES">Qualifying exempt financial services</option>}
            {countryCode === "SG" && config.taxTreatment === "out-of-scope" && <option value="SG_OUT_OF_SCOPE_OVERSEAS_TO_OVERSEAS_GOODS">Goods delivered overseas to overseas</option>}
            {countryCode === "GB" && config.taxTreatment === "reduced" && <option value="GB_REDUCED_DOMESTIC_FUEL_POWER">Qualifying domestic fuel and power</option>}
            {countryCode === "GB" && config.taxTreatment === "reverse-charge" && <option value="GB_DOMESTIC_CONSTRUCTION_REVERSE_CHARGE">Eligible domestic construction services (buyer must be VAT registered)</option>}
          </select>
        </label>
      </div>

      {countryCode === "GB" && config.taxTreatment === "reverse-charge" && (
        <div className="mt-3 rounded-lg border p-3 text-xs">
          <p className="font-bold">Buyer registration and reverse-charge eligibility</p>
          <p className="mt-1 text-muted-foreground">This category is limited to qualifying UK domestic construction services. Do not select it for an ordinary sale or where an exception applies.</p>
          <label className={labelClass + " mt-3"}>Buyer VAT registration number
            <input className={fieldClass} maxLength={80} value={config.buyerRegistrationNumber || invoice?.buyerRegistrationNumber || ""} onChange={(e) => update({ buyerRegistrationNumber: e.target.value, buyerRegistrationConfirmed: false })} placeholder="Enter buyer's VAT registration number" />
          </label>
          <label className="mt-3 flex items-start gap-2">
            <input type="checkbox" checked={config.buyerRegistrationConfirmed === true} onChange={(e) => update({ buyerRegistrationConfirmed: e.target.checked, buyerRegistrationStatus: e.target.checked ? "registered" : "unregistered" })} />
            <span>I confirm the buyer's VAT registration is active and matches the customer record.</span>
          </label>
          <label className="mt-2 flex items-start gap-2">
            <input type="checkbox" checked={config.reverseChargeConditionsConfirmed === true} onChange={(e) => update({ reverseChargeConditionsConfirmed: e.target.checked })} />
            <span>I confirm this supply meets the UK domestic construction reverse-charge conditions and no exception applies.</span>
          </label>
        </div>
      )}

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
          <p className="font-bold">Jurisdiction-specific rates are not auto-filled.</p>
          <p className="mt-1">US issuance requires an exact published state/county/city/ZIP rule; a missing local rule blocks issuance. Canadian provincial baselines are selected by province; product-specific PST exceptions and Quebec QST precision remain review-only. Manual rates are user-entered and unverified.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {isUS ? <>
              <label className={labelClass}>Destination state code<input className={fieldClass} maxLength={8} value={config.destinationJurisdiction?.state || ""} onChange={(e) => updateJurisdiction("state", e.target.value.toUpperCase())} placeholder="e.g. CA" /></label>
              <label className={labelClass}>Destination county<input className={fieldClass} maxLength={100} value={config.destinationJurisdiction?.county || ""} onChange={(e) => updateJurisdiction("county", e.target.value)} /></label>
              <label className={labelClass}>Destination city<input className={fieldClass} maxLength={100} value={config.destinationJurisdiction?.city || ""} onChange={(e) => updateJurisdiction("city", e.target.value)} /></label>
              <label className={labelClass}>Destination ZIP code<input className={fieldClass} maxLength={10} value={config.destinationJurisdiction?.postal_code || ""} onChange={(e) => updateJurisdiction("postal_code", e.target.value)} placeholder="e.g. 90012" /></label>
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
