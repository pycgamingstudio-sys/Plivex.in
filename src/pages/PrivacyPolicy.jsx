import LegalLayout, { LegalItem } from "@/components/LegalLayout";

export default function PrivacyPolicy() {
  return (
    <LegalLayout
      title="Privacy Policy"
      updated="October 5, 2026"
      intro="Effective Date: October 5, 2026 · App Name: Plivex · Contact: plivex.helps@gmail.com"
    >
      <LegalItem title="1. Information We Collect">Plivex collects personal and business information necessary to provide billing, GST reconciliation, and automated payment tracking services. This includes user name, business name, GSTIN, billing address, phone number, and email address (plivex.helps@gmail.com). We also process transactional data uploaded by users to render financial analytics.</LegalItem>
      <LegalItem title="2. How We Use Your Information">We use the collected data to enable invoice generation, payment status management, automated GST calculation, and customer support. We do not sell, rent, or trade your personal or business financial data to any third-party marketing entities.</LegalItem>
      <LegalItem title="3. Data Security & Storage">Plivex implements industry-standard encryption protocols (SSL/TLS) for data in transit and REST-level encryption for data at rest. Access to financial records is restricted to authorized account owners.</LegalItem>
      <LegalItem title="4. Third-Party Integrations">Plivex integrates with secure payment gateways and tax filing frameworks. Information shared with these providers is strictly limited to transaction fulfillment and tax verification requirements.</LegalItem>
      <LegalItem title="5. User Rights & Data Deletion">Users retain full ownership of their data. Account holders may request account deletion or export their invoice data at any time by contacting us at plivex.helps@gmail.com.</LegalItem>
    </LegalLayout>
  );
}