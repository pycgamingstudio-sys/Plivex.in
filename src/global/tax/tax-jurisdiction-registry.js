/**
 * Part 10: jurisdiction metadata for tax routing.
 *
 * This is not a complete local tax-rate database. US state/local rules are
 * deliberately represented as jurisdiction identifiers only. Canadian
 * province/territory rate components are informational source-backed defaults;
 * tax calculation still requires an explicit, reviewed rule and place of supply.
 */
export const TAX_JURISDICTION_CATALOG_VERSION = "2026.11.1";

const US_STATES = [
  ["AL","Alabama"],["AK","Alaska"],["AZ","Arizona"],["AR","Arkansas"],["CA","California"],
  ["CO","Colorado"],["CT","Connecticut"],["DE","Delaware"],["FL","Florida"],["GA","Georgia"],
  ["HI","Hawaii"],["ID","Idaho"],["IL","Illinois"],["IN","Indiana"],["IA","Iowa"],
  ["KS","Kansas"],["KY","Kentucky"],["LA","Louisiana"],["ME","Maine"],["MD","Maryland"],
  ["MA","Massachusetts"],["MI","Michigan"],["MN","Minnesota"],["MS","Mississippi"],["MO","Missouri"],
  ["MT","Montana"],["NE","Nebraska"],["NV","Nevada"],["NH","New Hampshire"],["NJ","New Jersey"],
  ["NM","New Mexico"],["NY","New York"],["NC","North Carolina"],["ND","North Dakota"],["OH","Ohio"],
  ["OK","Oklahoma"],["OR","Oregon"],["PA","Pennsylvania"],["RI","Rhode Island"],["SC","South Carolina"],
  ["SD","South Dakota"],["TN","Tennessee"],["TX","Texas"],["UT","Utah"],["VT","Vermont"],
  ["VA","Virginia"],["WA","Washington"],["WV","West Virginia"],["WI","Wisconsin"],["WY","Wyoming"],
  ["DC","District of Columbia"],
].map(([code,name]) => Object.freeze({ id:`US-${code}`, code, name, countryCode:"US", level:"state", localRateRequired:true }));

const CA_REGIONS = [
  ["AB","Alberta",500,0,"GST"],["BC","British Columbia",500,700,"GST+PST"],
  ["MB","Manitoba",500,700,"GST+PST"],["NB","New Brunswick",1500,0,"HST"],
  ["NL","Newfoundland and Labrador",1500,0,"HST"],["NS","Nova Scotia",1400,0,"HST"],
  ["ON","Ontario",1300,0,"HST"],["PE","Prince Edward Island",1500,0,"HST"],
  ["QC","Quebec",500,997.5,"GST+QST"],["SK","Saskatchewan",500,600,"GST+PST"],
  ["NT","Northwest Territories",500,0,"GST"],["NU","Nunavut",500,0,"GST"],["YT","Yukon",500,0,"GST"],
].map(([code,name,gstHstBps,pstQstBps,system]) => Object.freeze({
  id:`CA-${code}`, code, name, countryCode:"CA", level:"province_territory",
  components:Object.freeze([
    Object.freeze({ id:gstHstBps>=1300?`${code}-HST`:"GST", name:gstHstBps>=1300?"HST":"GST", rateBps:gstHstBps }),
    ...(pstQstBps ? [Object.freeze({ id:code==="QC"?"QST":"PST", name:code==="QC"?"QST":"PST", rateBps:pstQstBps })] : []),
  ]),
  system,
  source:"https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate.html",
  sourceAuthority:"Canada Revenue Agency",
  reviewedOn:"2026-11-15",
  coverage:"published-general-rates-only",
}));

const REGION_CODES = Object.freeze({
  IN:["AN","AP","AR","AS","BR","CH","CG","DN","DD","DL","GA","GJ","HR","HP","JK","JH","KA","KL","LA","LD","MP","MH","MN","ML","MZ","NL","OD","PB","PY","RJ","SK","TN","TS","TR","UP","UK","WB"],
  GB:["ENG","SCT","WLS","NIR"],
  AE:["AZ","DU","SH","AJ","UQ","RK","FJ"],
  AU:["NSW","VIC","QLD","WA","SA","TAS","ACT","NT"],
  SG:["SG"],
});

export function listTaxJurisdictions(countryCode) {
  const code = typeof countryCode === "string" ? countryCode.trim().toUpperCase() : "";
  if (code === "US") return US_STATES.map((item) => ({...item}));
  if (code === "CA") return CA_REGIONS.map((item) => ({...item,components:item.components.map(c=>({...c}))}));
  const names = REGION_CODES[code];
  if (!names) return [];
  return names.map(regionCode => ({
    id:`${code}-${regionCode}`, code:regionCode, countryCode:code,
    level: code==="SG"?"country":"first_level_region",
    name: regionCode, rateResolution:"country_rule_or_manual_review",
    calculationEnabled:false,
  }));
}

export function getTaxJurisdiction(countryCode, regionCode) {
  const code = typeof countryCode === "string" ? countryCode.trim().toUpperCase() : "";
  const region = typeof regionCode === "string" ? regionCode.trim().toUpperCase() : "";
  return listTaxJurisdictions(code).find(item => item.code === region || item.id === region) || null;
}

/**
 * Resolves only a destination jurisdiction identifier. It does not decide
 * place-of-supply law, seller nexus, product taxability or registration.
 */
export function resolveDestinationJurisdiction(input) {
  if (!input || typeof input !== "object") return {ok:false,code:"JURISDICTION_INPUT_REQUIRED"};
  const countryCode = typeof input.countryCode === "string" ? input.countryCode.trim().toUpperCase() : "";
  const regionCode = typeof input.regionCode === "string" ? input.regionCode.trim().toUpperCase() : "";
  if (!countryCode || !regionCode) return {ok:false,code:"DESTINATION_REGION_REQUIRED"};
  const jurisdiction = getTaxJurisdiction(countryCode,regionCode);
  if (!jurisdiction) return {ok:false,code:"UNKNOWN_DESTINATION_JURISDICTION",countryCode,regionCode};
  if (countryCode === "US") return {
    ok:true,status:"jurisdiction_identified_review_required",jurisdiction,
    requirements:["county_or_city_if_applicable","product_taxability","sourcing_rule","seller_nexus","registration_permit"],
  };
  if (countryCode === "CA") return {
    ok:true,status:"jurisdiction_identified_review_required",jurisdiction,
    requirements:["place_of_supply_rule","province_specific_taxability","seller_registration_obligation"],
  };
  return {ok:true,status:"jurisdiction_identified_no_tax_decision",jurisdiction};
}
