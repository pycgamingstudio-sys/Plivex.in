import LegalLayout, { LegalItem } from "@/components/LegalLayout";

export default function PrivacyPolicy() {
  return (
    <LegalLayout
      title="Privacy Policy"
      updated="October 5, 2026"
      intro="Effective Date: October 5, 2026 · App Name: Plivex · Contact: support@plivex.in"
    >
      <LegalItem title="1. Information We Collect">Plivex collects personal and business information needed to provide the features available in your workspace. This may include your name, business name, country-specific tax registration details (where supplied), billing address, phone number, email address, invoice and customer records, and transaction data you choose to store. We process this information to provide invoicing, supported tax workflows, payment tracking, and other enabled business tools.</LegalItem>
      <LegalItem title="2. How We Use Your Information">We use the collected data to provide and secure Plivex features, including invoice generation, supported country-specific tax workflows, payment status management, and customer support. Feature availability depends on your workspace country and the current release. We do not sell, rent, or trade your personal or business financial data to third-party marketing entities.</LegalItem>
      <LegalItem title="3. Data Security & Storage">Plivex implements industry-standard encryption protocols (SSL/TLS) for data in transit and REST-level encryption for data at rest. Access to financial records is restricted to authorized account owners.</LegalItem>
      <LegalItem title="4. Third-Party Integrations">Plivex may integrate with payment processors and other service providers used to deliver enabled features. Information is shared when needed to provide the requested service, process a transaction, meet applicable requirements, or when you direct Plivex to share it.</LegalItem>
      <LegalItem title="5. User Rights & Data Deletion">Users retain full ownership of their data. Account holders may request account deletion or export their invoice data at any time by contacting us at support@plivex.in.</LegalItem>
    </LegalLayout>
  );
}