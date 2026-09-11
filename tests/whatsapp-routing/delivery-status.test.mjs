import assert from "node:assert/strict";
import test from "node:test";

import { extractWhatsAppDeliveryStatuses } from "../../lib/whatsapp-delivery-status.mjs";

test("extracts successful operational WhatsApp delivery status", () => {
  const rows = extractWhatsAppDeliveryStatuses({
    entry: [{ changes: [{ value: { statuses: [{
      id: "wamid.success",
      recipient_id: "972500000000",
      status: "delivered",
      timestamp: "1789132454",
      conversation: { id: "conversation-1" },
      pricing: { category: "service" }
    }] } }] }]
  });

  assert.deepEqual(rows, [{
    messageId: "wamid.success",
    recipientId: "972500000000",
    status: "delivered",
    errorCode: "",
    errorTitle: "",
    errorMessage: "",
    conversationId: "conversation-1",
    pricingCategory: "service",
    providerTimestamp: "1789132454"
  }]);
});

test("extracts Meta failure details without retaining message content", () => {
  const rows = extractWhatsAppDeliveryStatuses({
    entry: [{ changes: [{ value: { statuses: [{
      id: "wamid.failed",
      recipient_id: "972500000000",
      status: "failed",
      errors: [{ code: 131026, title: "Message undeliverable", error_data: { details: "Unable to deliver message" } }]
    }] } }] }]
  });

  assert.equal(rows[0].status, "failed");
  assert.equal(rows[0].errorCode, "131026");
  assert.equal(rows[0].errorTitle, "Message undeliverable");
  assert.equal(rows[0].errorMessage, "Unable to deliver message");
});
