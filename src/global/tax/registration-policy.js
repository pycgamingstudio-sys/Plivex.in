/**
 * Registration-obligation reference profiles.
 * Thresholds are informational screening inputs, never an automated legal
 * conclusion. Exceptions, non-resident rules and compulsory-registration
 * categories require professional review.
 */
export const REGISTRATION_POLICY_VERSION = "2026.11.1";

const POLICIES = Object.freeze({
  IN: {
    countryCode:"IN", taxName:"GST", identifier:"GSTIN",
    mode:"complex_threshold_and_compulsory_cases",
    threshold:null, currencyCode:"INR",
    source:"https://cbic-gst.gov.in/CGST-bill-e.html",
    sourceAuthority:"Central Board of Indirect Taxes and Customs",
    reviewRequired:true,
    notes:"Threshold depends on supply type, state, turnover aggregation and compulsory-registration exceptions. Do not encode one nationwide threshold.",
  },
  US: {
    countryCode:"US", taxName:"State and local sales tax", identifier:"state_sales_tax_permit",
    mode:"state_economic_and_physical_nexus",
    threshold:null, currencyCode:"USD",
    source:"https://www.streamlinedsalestax.org/",
    sourceAuthority:"Streamlined Sales Tax Governing Board",
    reviewRequired:true,
    notes:"Economic nexus thresholds and registration rules vary by state and can change. Physical presence, marketplace and product-specific rules also matter.",
  },
  GB: {
    countryCode:"GB", taxName:"VAT", identifier:"VAT registration number",
    mode:"taxable_turnover_threshold_with_non_established_exceptions",
    threshold:{amountMinor:9000000,currencyCode:"GBP",basis:"taxable_turnover_last_12_months_or_expected_next_30_days"},
    source:"https://www.gov.uk/register-for-vat",
    sourceAuthority:"HM Revenue & Customs",
    reviewedOn:"2026-11-15", reviewRequired:true,
    notes:"Non-established taxable persons can have a registration obligation regardless of the domestic threshold; exemptions and other exceptions require review.",
  },
  AE: {
    countryCode:"AE", taxName:"VAT", identifier:"TRN",
    mode:"taxable_supplies_and_imports_threshold",
    threshold:{amountMinor:37500000,currencyCode:"AED",basis:"mandatory_previous_12_months_or_expected_next_30_days"},
    voluntaryThreshold:{amountMinor:18750000,currencyCode:"AED",basis:"taxable_supplies_imports_or_taxable_expenses"},
    source:"https://www.tax.gov.ae/en/taxes/Vat/vat.topics/registration.for.vat.aspx",
    sourceAuthority:"UAE Federal Tax Authority",
    reviewedOn:"2026-11-15", reviewRequired:true,
    notes:"Non-resident businesses may be required to register regardless of threshold; designated zones and special cases require review.",
  },
  CA: {
    countryCode:"CA", taxName:"GST/HST/PST/QST", identifier:"GST/HST account and provincial registrations",
    mode:"small_supplier_and_province_specific_registration",
    threshold:null, currencyCode:"CAD",
    source:"https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses.html",
    sourceAuthority:"Canada Revenue Agency",
    reviewRequired:true,
    notes:"Small-supplier rules, associated persons, voluntary registration and separate provincial registrations require case-specific analysis.",
  },
  AU: {
    countryCode:"AU", taxName:"GST", identifier:"ABN with GST registration",
    mode:"gst_turnover_threshold",
    threshold:{amountMinor:7500000,currencyCode:"AUD",basis:"annual_gst_turnover"},
    nonProfitThreshold:{amountMinor:15000000,currencyCode:"AUD",basis:"annual_gst_turnover_non_profit"},
    source:"https://www.ato.gov.au/business/gst/registering-for-gst/",
    sourceAuthority:"Australian Taxation Office",
    reviewedOn:"2026-11-15", reviewRequired:true,
    notes:"Different rules can apply to taxi/ride-sourcing, non-residents and other special entities; ABN status alone is not proof of GST registration.",
  },
  SG: {
    countryCode:"SG", taxName:"GST", identifier:"GST registration number",
    mode:"retrospective_or_prospective_taxable_turnover",
    threshold:{amountMinor:100000000,currencyCode:"SGD",basis:"taxable_turnover_calendar_year_or_expected_next_12_months"},
    source:"https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/gst-registration-deregistration/do-i-need-to-register-for-gst",
    sourceAuthority:"Inland Revenue Authority of Singapore",
    reviewedOn:"2026-11-15", reviewRequired:true,
    notes:"Retrospective and prospective tests differ; special grace periods, exemptions and overseas vendor rules require review.",
  },
});

const clone = value => structuredClone(value);
export function getRegistrationPolicy(countryCode) {
  const code = typeof countryCode === "string" ? countryCode.trim().toUpperCase() : "";
  return POLICIES[code] ? clone(POLICIES[code]) : null;
}
export function listRegistrationPolicies() {
  return Object.keys(POLICIES).map(getRegistrationPolicy);
}

/**
 * A screening result only. It never states that a person is legally registered
 * or unregistered; it points the operator to professional review.
 */
export function screenRegistrationProfile(input) {
  if (!input || typeof input !== "object") return {ok:false,code:"REGISTRATION_PROFILE_REQUIRED"};
  const policy = getRegistrationPolicy(input.countryCode);
  if (!policy) return {ok:false,code:"COUNTRY_REGISTRATION_POLICY_NOT_CONFIGURED"};
  if (input.registrationStatus === "registered" && typeof input.registrationNumber === "string" && input.registrationNumber.trim()) {
    return {ok:true,status:"user_attested_registration_present",policy,requiresVerification:true};
  }
  if (input.registrationStatus === "not_registered") {
    return {ok:true,status:"not_registered_user_attested",policy,requiresVerification:true};
  }
  return {ok:true,status:"registration_status_unknown",policy,requiresVerification:true};
}
