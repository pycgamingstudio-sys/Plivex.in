import test from "node:test";
import assert from "node:assert/strict";
import { listTaxJurisdictions, getTaxJurisdiction, resolveDestinationJurisdiction } from "../tax/tax-jurisdiction-registry.js";
import { getRegistrationPolicy, listRegistrationPolicies, screenRegistrationProfile } from "../tax/registration-policy.js";
import { getAllowedTaxTreatments, getRequiredClassificationFields, validateProductTaxClassification } from "../tax/product-tax-classification.js";

test("jurisdiction catalogue covers all 50 US states plus DC without inventing tax rates",()=>{
 const regions=listTaxJurisdictions("US");
 assert.equal(regions.length,51);
 assert.ok(regions.some(r=>r.id==="US-CA"));
 assert.ok(regions.some(r=>r.id==="US-DC"));
 assert.ok(regions.every(r=>r.localRateRequired===true && !("rateBps" in r)));
});
test("US destination resolution requires county/city, taxability, sourcing and nexus review",()=>{
 const r=resolveDestinationJurisdiction({countryCode:"US",regionCode:"CA"});
 assert.equal(r.ok,true);
 assert.equal(r.status,"jurisdiction_identified_review_required");
 assert.ok(r.requirements.includes("seller_nexus"));
 assert.equal(resolveDestinationJurisdiction({countryCode:"US",regionCode:"XX"}).code,"UNKNOWN_DESTINATION_JURISDICTION");
});
test("Canada registry covers 10 provinces/territories and source-backed published GST/HST/PST/QST components",()=>{
 const regions=listTaxJurisdictions("CA");
 assert.equal(regions.length,13);
 const on=getTaxJurisdiction("CA","ON");
 assert.deepEqual(on.components.map(c=>c.ratePercent),[13]);
 const qc=getTaxJurisdiction("CA","QC");
 assert.deepEqual(qc.components.map(c=>c.rateBps),[5,9.975]);
 const bc=getTaxJurisdiction("CA","BC");
 assert.deepEqual(bc.components.map(c=>c.rateBps),[5,7]);
 assert.ok(regions.every(r=>r.sourceAuthority==="Canada Revenue Agency"));
});
test("India and other regional registries identify administrative regions but do not imply tax rules",()=>{
 assert.ok(listTaxJurisdictions("IN").length>25);
 assert.equal(listTaxJurisdictions("GB").length,4);
 assert.equal(listTaxJurisdictions("AE").length,7);
 assert.equal(listTaxJurisdictions("AU").length,8);
 assert.equal(listTaxJurisdictions("SG").length,1);
 assert.equal(listTaxJurisdictions("ZZ").length,0);
});
test("registration profiles cover all seven countries and preserve complex cases for review",()=>{
 const policies=listRegistrationPolicies();
 assert.deepEqual(policies.map(p=>p.countryCode).sort(),["AE","AU","CA","GB","IN","SG","US"]);
 assert.equal(getRegistrationPolicy("GB").threshold.amountMinor,9000000);
 assert.equal(getRegistrationPolicy("AE").threshold.amountMinor,37500000);
 assert.equal(getRegistrationPolicy("AE").voluntaryThreshold.amountMinor,18750000);
 assert.equal(getRegistrationPolicy("AU").threshold.amountMinor,7500000);
 assert.equal(getRegistrationPolicy("SG").threshold.amountMinor,100000000);
 assert.equal(getRegistrationPolicy("IN").threshold,null);
 assert.equal(getRegistrationPolicy("US").threshold,null);
 assert.equal(getRegistrationPolicy("CA").threshold,null);
 assert.ok(policies.every(p=>p.reviewRequired===true));
});
test("registration screen is explicitly informational and requires verification",()=>{
 const r=screenRegistrationProfile({countryCode:"GB",registrationStatus:"registered",registrationNumber:"GB123"});
 assert.equal(r.status,"user_attested_registration_present");
 assert.equal(r.requiresVerification,true);
 assert.equal(screenRegistrationProfile({countryCode:"ZZ"}).code,"COUNTRY_REGISTRATION_POLICY_NOT_CONFIGURED");
});
test("product tax treatments are country-specific and unknown classifications fail closed",()=>{
 assert.ok(getAllowedTaxTreatments("AU").includes("gst_free"));
 assert.ok(getAllowedTaxTreatments("AU").includes("input_taxed"));
 assert.ok(getAllowedTaxTreatments("GB").includes("reduced_rated"));
 assert.ok(getAllowedTaxTreatments("US").includes("taxable"));
 assert.ok(getAllowedTaxTreatments("IN").includes("nil_rated"));
 assert.equal(validateProductTaxClassification({countryCode:"SG",treatment:"unknown"}).code,"TAX_TREATMENT_UNRESOLVED");
});
test("classification needs explicit business review and all country-specific fields",()=>{
 const missing=validateProductTaxClassification({countryCode:"GB",treatment:"standard_rated",reviewedByBusiness:true,reviewedOn:"2026-11-15"});
 assert.equal(missing.code,"CLASSIFICATION_FIELDS_MISSING");
 assert.ok(missing.missingFields.includes("vatCommodityCategory"));
 const valid=validateProductTaxClassification({
  countryCode:"AU",treatment:"gst_free",reviewedByBusiness:true,reviewedOn:"2026-11-15",
  supplyType:"goods",gstTreatment:"gst_free",exportOrConnectedWithAustralia:"connected",placeOfSupply:"AU"
 });
 assert.equal(valid.ok,true);
 assert.equal(valid.taxCalculationEnabled,false);
});
test("US exempt treatment needs a certificate reference",()=>{
 const base={countryCode:"US",treatment:"exempt",reviewedByBusiness:true,reviewedOn:"2026-11-15",supplyType:"goods",productTaxCategory:"clothing",destinationState:"NY",localJurisdiction:"NYC"};
 assert.equal(validateProductTaxClassification(base).code,"EXEMPTION_CERTIFICATE_REFERENCE_REQUIRED");
 assert.equal(validateProductTaxClassification({...base,exemptionCertificateId:"CERT-1"}).ok,true);
});
