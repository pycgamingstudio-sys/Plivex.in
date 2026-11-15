/**
 * Country experience metadata for the unified Plivex application.
 *
 * This is presentation and workflow metadata only. It is not a tax-law source,
 * payment-provider availability list, legal-registration validator or FX engine.
 * Tax capability must always be checked separately by global-tax-capabilities.js.
 */
import { getCountryByCode } from "./country-registry.js";

const EXPERIENCES = Object.freeze({
  IN: {
    defaultLocale: "en-IN",
    direction: "ltr",
    dateStyle: "dd/MM/yyyy",
    address: { regionLabel: "State", postalCodeLabel: "PIN code", postalCodePattern: "^[1-9][0-9]{5}$" },
    business: { registrationLabel: "GSTIN", taxName: "GST", classificationLabel: "HSN/SAC" },
    document: { taxInvoiceTitle: "Tax Invoice", creditNoteTitle: "Credit Note", debitNoteTitle: "Debit Note" },
    timeZonePolicy: "Asia/Kolkata",
    taxCapabilityKey: "IN",
  },
  US: {
    defaultLocale: "en-US",
    direction: "ltr",
    dateStyle: "MM/dd/yyyy",
    address: { regionLabel: "State", postalCodeLabel: "ZIP code", postalCodePattern: "^[0-9]{5}(-[0-9]{4})?$" },
    business: { registrationLabel: "Sales tax permit number", taxName: "Sales tax", classificationLabel: "Product/service tax category" },
    document: { taxInvoiceTitle: "Sales Tax Invoice", creditNoteTitle: "Credit Memo", debitNoteTitle: "Debit Memo" },
    timeZonePolicy: "workspace-select",
    taxCapabilityKey: "US",
  },
  GB: {
    defaultLocale: "en-GB",
    direction: "ltr",
    dateStyle: "dd/MM/yyyy",
    address: { regionLabel: "County / region", postalCodeLabel: "Postcode", postalCodePattern: "^[A-Z]{1,2}[0-9R][0-9A-Z]? ?[0-9][A-Z]{2}$" },
    business: { registrationLabel: "VAT registration number", taxName: "VAT", classificationLabel: "VAT treatment" },
    document: { taxInvoiceTitle: "VAT Invoice", creditNoteTitle: "Credit Note", debitNoteTitle: "Debit Note" },
    timeZonePolicy: "Europe/London",
    taxCapabilityKey: "GB",
  },
  AE: {
    defaultLocale: "en-AE",
    direction: "ltr",
    dateStyle: "dd/MM/yyyy",
    address: { regionLabel: "Emirate", postalCodeLabel: "PO Box", postalCodePattern: null },
    business: { registrationLabel: "TRN", taxName: "VAT", classificationLabel: "VAT treatment" },
    document: { taxInvoiceTitle: "Tax Invoice", creditNoteTitle: "Credit Note", debitNoteTitle: "Debit Note" },
    timeZonePolicy: "Asia/Dubai",
    taxCapabilityKey: "AE",
  },
  CA: {
    defaultLocale: "en-CA",
    direction: "ltr",
    dateStyle: "yyyy-MM-dd",
    address: { regionLabel: "Province / territory", postalCodeLabel: "Postal code", postalCodePattern: "^[A-Z][0-9][A-Z] ?[0-9][A-Z][0-9]$" },
    business: { registrationLabel: "GST/HST account number", taxName: "GST/HST/PST/QST", classificationLabel: "Supply tax treatment" },
    document: { taxInvoiceTitle: "GST/HST Invoice", creditNoteTitle: "Credit Note", debitNoteTitle: "Debit Note" },
    timeZonePolicy: "workspace-select",
    taxCapabilityKey: "CA",
  },
  AU: {
    defaultLocale: "en-AU",
    direction: "ltr",
    dateStyle: "dd/MM/yyyy",
    address: { regionLabel: "State / territory", postalCodeLabel: "Postcode", postalCodePattern: "^[0-9]{4}$" },
    business: { registrationLabel: "ABN", taxName: "GST", classificationLabel: "GST treatment" },
    document: { taxInvoiceTitle: "Tax Invoice", creditNoteTitle: "Adjustment Note", debitNoteTitle: "Adjustment Note" },
    timeZonePolicy: "workspace-select",
    taxCapabilityKey: "AU",
  },
  SG: {
    defaultLocale: "en-SG",
    direction: "ltr",
    dateStyle: "dd/MM/yyyy",
    address: { regionLabel: "Planning area", postalCodeLabel: "Postal code", postalCodePattern: "^[0-9]{6}$" },
    business: { registrationLabel: "GST registration number", taxName: "GST", classificationLabel: "GST treatment" },
    document: { taxInvoiceTitle: "Tax Invoice", creditNoteTitle: "Credit Note", debitNoteTitle: "Debit Note" },
    timeZonePolicy: "Asia/Singapore",
    taxCapabilityKey: "SG",
  },
});

export function getCountryExperience(countryCode) {
  const country = getCountryByCode(countryCode);
  if (!country) return null;
  const experience = EXPERIENCES[country.code];
  if (!experience) return null;
  return Object.freeze({
    countryCode: country.code,
    countryName: country.name,
    currencyCode: country.currencyCode,
    phoneCode: country.phoneCode,
    locales: [...country.locales],
    ...experience,
    address: Object.freeze({ ...experience.address }),
    business: Object.freeze({ ...experience.business }),
    document: Object.freeze({ ...experience.document }),
  });
}

export function listCountryExperiences() {
  return Object.keys(EXPERIENCES).map(getCountryExperience);
}
