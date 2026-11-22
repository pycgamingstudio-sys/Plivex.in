/**
 * Server-only resolver for global.tax_rule_versions.
 * Draft rows are usable only when ALLOW_DRAFT_TAX_RULES=true; results are
 * explicitly labelled draft_test and must never be treated as verified.
 */
const validDate = (value: unknown): value is string => typeof value === "string" && /^\\d{4}-\\d{2}-\\d{2}$/.test(value);
const COUNTRY_CURRENCY: Record<string,string> = { IN:"INR", US:"USD", GB:"GBP", AE:"AED", CA:"CAD", AU:"AUD", SG:"SGD" };

export async function resolveSupabaseTaxRule(
  db: any,
  input: { countryCode: string; jurisdictionId?: string | null; invoiceDate: string; treatment?: string; taxCode?: string | null },
  allowDraft = Deno.env.get("ALLOW_DRAFT_TAX_RULES") !== "false",
) {
  const countryCode = String(input.countryCode || "").toUpperCase();
  const invoiceDate = input.invoiceDate;
  if (!COUNTRY_CURRENCY[countryCode] || !validDate(invoiceDate)) {
    return { ok:false, code:"INVALID_TAX_RULE_LOOKUP", message:"Workspace country and invoice date are required." };
  }
  const jurisdictionId = String(input.jurisdictionId || (countryCode === "US" || countryCode === "CA" ? "" : countryCode)).trim().toUpperCase();
  if ((countryCode === "US" || countryCode === "CA") && !jurisdictionId) {
    return { ok:false, code:"DESTINATION_JURISDICTION_REQUIRED", message:"Select the destination state or province first." };
  }
  const statuses = allowDraft ? ["verified","draft"] : ["verified"];
  const { data, error } = await db.schema("global").from("tax_rule_versions")
    .select("country_code,jurisdiction_id,currency_code,tax_code,version,treatment,effective_from,effective_to,reviewed_on,reviewed_by,source_url,components,status")
    .eq("country_code", countryCode)
    .eq("jurisdiction_id", jurisdictionId)
    .in("status", statuses)
    .lte("effective_from", invoiceDate)
    .or("effective_to.is.null,effective_to.gte." + invoiceDate)
    .order("effective_from", { ascending:false });
  if (error) return { ok:false, code:"TAX_RULE_LOOKUP_FAILED", message:"Workspace tax rules could not be loaded." };
  let rows = (data || []).filter((row: any) => row.currency_code === COUNTRY_CURRENCY[countryCode]);
  // This is a federal reference row, not an additional component. Province
  // records already contain the applicable GST/HST/PST/QST components.
  if (countryCode === "CA") rows = rows.filter((row: any) => row.tax_code !== "GST_FED_BASE");
  if (input.taxCode) rows = rows.filter((row: any) => row.tax_code === input.taxCode);
  if (input.treatment) rows = rows.filter((row: any) => row.treatment === input.treatment);
  if (!rows.length) return { ok:false, code:"NO_EFFECTIVE_TAX_RULE", message:allowDraft
    ? "No effective rule exists for this workspace country and jurisdiction."
    : "No verified rule exists for this workspace country and jurisdiction." };
  // Verified records always win. Draft fallback is explicit test-only mode.
  const verifiedRows = rows.filter((row: any) => row.status === "verified");
  const selectedRows = verifiedRows.length ? verifiedRows : rows.filter((row: any) => row.status === "draft");
  if (!selectedRows.length) return { ok:false, code:"NO_VERIFIED_TAX_RULE", message:"No verified rule is available." };
  // Keep the newest effective version for each tax code. Canada may have
  // separate effective dates for GST and PST/QST components in one province.
  const latestByCode = new Map<string, any>();
  for (const row of selectedRows) {
    const previous = latestByCode.get(row.tax_code);
    if (!previous || row.effective_from > previous.effective_from) latestByCode.set(row.tax_code, row);
  }
  const effectiveRows = [...latestByCode.values()];
  // Canada provincial GST/PST/QST rows are additive components for the same
  // destination. GST_FED_BASE is deliberately excluded above to avoid doubling.
  if (countryCode !== "CA" && effectiveRows.length !== 1) {
    return { ok:false, code:"AMBIGUOUS_TAX_RULE", message:"Choose the exact tax category/rule before calculating." };
  }
  const first = effectiveRows[0];
  const components = effectiveRows.flatMap((row: any) => Array.isArray(row.components) ? row.components : []);
  if (!components.length || components.some((c: any) => !Number.isInteger(c.rateBps) || c.rateBps < 0 || c.rateBps > 10000)) {
    return { ok:false, code:"INVALID_TAX_COMPONENTS", message:"The selected tax rule has invalid components." };
  }
  const totalRateBps = components.reduce((sum: number, component: any) => sum + Number(component.rateBps), 0);
  if (totalRateBps > 10000) return { ok:false, code:"COMBINED_RATE_OUT_OF_RANGE", message:"Combined jurisdiction tax rate is outside supported limits." };
  return {
    ok:true,
    mode:first.status === "verified" ? "verified" : "draft_test",
    rule:{
      id:effectiveRows.map((row: any)=>row.tax_code).join("+"), version:first.version,
      countryCode:first.country_code, currencyCode:first.currency_code,
      jurisdictionId:first.jurisdiction_id, treatment:first.treatment,
      effectiveFrom:first.effective_from, effectiveTo:first.effective_to,
      source:first.source_url, reviewedOn:first.reviewed_on, reviewedBy:first.reviewed_by,
      status:first.status, components:components.map((c: any)=>({
        id:String(c.id), name:String(c.name || c.id), rateBps:Number(c.rateBps),
        source:String(c.source || first.source_url || ""),
      })),
    },
  };
}
