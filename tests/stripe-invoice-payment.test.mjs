import assert from "node:assert/strict";
import test from "node:test";
import { isSuccessfulStripeInvoicePayment } from "../lib/stripe-invoice-payment.mjs";

test("only positive, completed Stripe payments applied to this invoice count", () => {
  const payment = { invoice: "in_1", status: "paid", amount_paid: 100, payment: { type: "payment_intent", payment_intent: "pi_1" } };
  assert.equal(isSuccessfulStripeInvoicePayment(payment, "in_1"), true);
  for (const change of [
    { status: "open" }, { status: "canceled" }, { status: "failed" },
    { amount_paid: 0 }, { invoice: "in_other" },
    { payment: { type: "payment_record", payment_record: "pr_1" } },
    { payment: { type: "payment_intent" } }
  ]) {
    assert.equal(isSuccessfulStripeInvoicePayment({ ...payment, ...change }, "in_1"), false);
  }
});
