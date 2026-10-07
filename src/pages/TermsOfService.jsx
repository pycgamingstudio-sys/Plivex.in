import LegalLayout, { LegalItem } from "@/components/LegalLayout";

export default function TermsOfService() {
  return (
    <LegalLayout
      title="Terms & Conditions"
      updated="October 5, 2026"
      intro="Effective Date: October 5, 2026 · App Name: Plivex · Contact: plivex.helps@gmail.com"
    >
      <LegalItem title="1. Acceptance of Terms">By accessing or using Plivex, you agree to be bound by these Terms & Conditions. If you do not agree, you must discontinue using our services immediately.</LegalItem>
      <LegalItem title="2. Service Overview">Plivex provides B2B software solutions for billing automation, GST reconciliation, invoice status tracking, and payment workflow management.</LegalItem>
      <LegalItem title="3. User Account Responsibilities">Users are responsible for maintaining the confidentiality of their login credentials and all activities occurring under their account. You agree to provide accurate GSTIN and business information. Plivex is not liable for errors in tax filings arising from incorrect user input.</LegalItem>
      <LegalItem title="4. Software Availability & Maintenance">While Plivex strives for 99.9% platform uptime, scheduled maintenance, system updates, or emergency fixes may cause temporary downtime.</LegalItem>
      <LegalItem title="5. Termination">Plivex reserves the right to suspend or terminate access to any user found engaging in fraudulent financial activities, unauthorized platform modifications, or violation of these Terms.</LegalItem>
    </LegalLayout>
  );
}