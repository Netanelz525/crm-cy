export function isSuccessfulStripeInvoicePayment(entry, invoiceId) {
  return entry?.invoice === invoiceId
    && entry.status === "paid"
    && Number(entry.amount_paid) > 0
    && (
      (entry.payment?.type === "payment_intent" && /^pi_/.test(entry.payment.payment_intent || ""))
      || (entry.payment?.type === "charge" && /^ch_/.test(entry.payment.charge || ""))
    );
}
