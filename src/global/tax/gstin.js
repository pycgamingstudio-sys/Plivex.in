const PAN_ENTITY_TYPES = Object.freeze({
  A: "Association of Persons (AOP)",
  B: "Body of Individuals (BOI)",
  C: "Company",
  F: "Firm / LLP",
  G: "Government",
  H: "Hindu Undivided Family (HUF)",
  J: "Artificial Juridical Person",
  L: "Local Authority",
  P: "Individual",
  T: "Trust",
});

const STATE_CODES = Object.freeze({
  "01":"Jammu and Kashmir","02":"Himachal Pradesh","03":"Punjab","04":"Chandigarh","05":"Uttarakhand",
  "06":"Haryana","07":"Delhi","08":"Rajasthan","09":"Uttar Pradesh","10":"Bihar","11":"Sikkim",
  "12":"Arunachal Pradesh","13":"Nagaland","14":"Manipur","15":"Mizoram","16":"Tripura","17":"Meghalaya",
  "18":"Assam","19":"West Bengal","20":"Jharkhand","21":"Odisha","22":"Chhattisgarh","23":"Madhya Pradesh",
  "24":"Gujarat","25":"Daman and Diu (legacy)","26":"Dadra and Nagar Haveli and Daman and Diu","27":"Maharashtra","28":"Andhra Pradesh (legacy)",
  "29":"Karnataka","30":"Goa","31":"Lakshadweep","32":"Kerala","33":"Tamil Nadu","34":"Puducherry",
  "35":"Andaman and Nicobar Islands","36":"Telangana","37":"Andhra Pradesh","38":"Ladakh","97":"Other Territory",
});

/**
 * Parse the visible 15-character GSTIN structure without claiming government
 * verification or validating the final checksum character.
 */
export function parseIndianGstin(value) {
  const gstin = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  const match = gstin.match(/^([0-9]{2})([A-Z]{5}[0-9]{4}[A-Z])([0-9A-Z])Z([0-9A-Z])$/);
  if (!match) return { ok:false, code:"INVALID_GSTIN_FORMAT", message:"GSTIN must match the 15-character GSTIN format." };
  const [, stateCode, pan, entityCode, checksum] = match;
  const stateName = STATE_CODES[stateCode];
  if (!stateName) return { ok:false, code:"UNKNOWN_GSTIN_STATE_CODE", message:"GSTIN state code is not recognized." };
  return {
    ok:true, gstin, stateCode, stateName, pan, entityCode, checksum,
    panEntityCode:pan[3],
    panEntityType:PAN_ENTITY_TYPES[pan[3]] || "Unknown PAN entity type",
    panHolderInitial:pan[4],
    verification:"format_only",
    warning:"Format and state code only. GSTIN registration status and checksum are not verified against government records.",
  };
}

export function getIndianGstinState(value) {
  const parsed = parseIndianGstin(value);
  return parsed.ok ? { stateCode:parsed.stateCode, stateName:parsed.stateName } : null;
}

/**
 * Find exact GSTIN matches in records already loaded from the active workspace.
 * This is a local lookup only; it never calls or impersonates a GSTN verification API.
 */
export function findSavedGstinRecords(records, value) {
  const parsed = parseIndianGstin(value);
  if (!parsed.ok || !Array.isArray(records)) return [];
  return records.filter((record) => {
    const saved = String(record?.tax_registration_number || record?.gstin || "")
      .trim().toUpperCase().replace(/\\s+/g, "");
    return saved === parsed.gstin;
  });
}
