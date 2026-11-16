/**
 * Explicit registration/collection-obligation gate.
 * Never infers registration, economic nexus, thresholds or taxability.
 */
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (value) => {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
};
export function assessTaxCollectionObligation({ countryCode, jurisdictionId = null, invoiceDate, registration } = {}) {
  const country = typeof countryCode === "string" ? countryCode.toUpperCase() : "";
  if (!["US", "GB", "AE", "CA", "AU", "SG"].includes(country)) {
    return { ok: false, status: "needs_review", code: country === "IN" ? "INDIA_LEGACY_ADAPTER_REQUIRED" : "UNSUPPORTED_COUNTRY" };
  }
  if (!validDate(invoiceDate) || !registration || typeof registration !== "object" || Array.isArray(registration)) {
    return { ok: false, status: "needs_review", code: "REGISTRATION_EVIDENCE_REQUIRED" };
  }
  if (registration.status !== "registered" || !validDate(registration.effectiveFrom)
    || invoiceDate < registration.effectiveFrom || (registration.effectiveTo && (!validDate(registration.effectiveTo) || invoiceDate > registration.effectiveTo))
    || typeof registration.registrationNumber !== "string" || !registration.registrationNumber.trim()
    || registration.confirmedByBusiness !== true) {
    return { ok: false, status: "needs_review", code: "REGISTRATION_NOT_CONFIRMED_OR_EFFECTIVE" };
  }
  if (["US", "CA"].includes(country)) {
    if (typeof jurisdictionId !== "string" || !jurisdictionId.trim()
      || registration.jurisdictionId !== jurisdictionId
      || registration.collectionObligationConfirmed !== true
      || typeof registration.obligationEvidenceReference !== "string" || !registration.obligationEvidenceReference.trim()) {
      return { ok: false, status: "needs_review", code: "JURISDICTION_OR_COLLECTION_OBLIGATION_UNVERIFIED" };
    }
  }
  return {
    ok: true, status: "business_attested", countryCode: country,
    jurisdictionId: jurisdictionId || null, registrationNumber: registration.registrationNumber,
    effectiveFrom: registration.effectiveFrom, effectiveTo: registration.effectiveTo || null,
    evidenceReference: registration.obligationEvidenceReference || null,
    warning: "Plivex records the business confirmation; it does not independently determine or verify legal registration, nexus or collection obligation.",
  };
}
