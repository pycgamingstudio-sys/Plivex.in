import LegalLayout, { LegalItem } from "@/components/LegalLayout";

export default function CancellationRefund() {
  return (
    <LegalLayout
      title="Refund & Cancellation Policy"
      updated="October 5, 2026"
      intro="Effective Date: October 5, 2026 · App Name: Plivex · Contact: plivex.helps@gmail.com"
    >
      <LegalItem title="1. Subscription Cancellations">Users can cancel their active Plivex subscription at any time directly through the dashboard account settings or by emailing plivex.helps@gmail.com. Upon cancellation, subscription renewal will be disabled for the subsequent billing cycle.</LegalItem>
      <LegalItem title="2. Refund Eligibility">Monthly Plans: Monthly subscription fees are non-refundable once the billing cycle has commenced. Annual Plans: A full refund is permissible within 7 days of initial purchase if no significant invoice generation or automated features have been utilized.</LegalItem>
      <LegalItem title="3. Service Outages & Credits">In the event of prolonged system failure attributable directly to Plivex, pro-rated service credits may be assigned to the user's account upon approval from support (plivex.helps@gmail.com).</LegalItem>
      <LegalItem title="4. Refund Processing Time">Approved refunds are processed back to the original payment method within 5–7 business days.</LegalItem>
    </LegalLayout>
  );
}