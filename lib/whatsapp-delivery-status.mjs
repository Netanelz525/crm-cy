function clean(value) {
  return String(value || "").trim();
}

export function extractWhatsAppDeliveryStatuses(payload) {
  return (Array.isArray(payload?.entry) ? payload.entry : []).flatMap((entry) =>
    (Array.isArray(entry?.changes) ? entry.changes : []).flatMap((change) =>
      (Array.isArray(change?.value?.statuses) ? change.value.statuses : []).map((status) => {
        const error = Array.isArray(status?.errors) ? status.errors[0] : null;
        return {
          messageId: clean(status?.id),
          recipientId: clean(status?.recipient_id),
          status: clean(status?.status).toLowerCase() || "unknown",
          errorCode: clean(error?.code),
          errorTitle: clean(error?.title),
          errorMessage: clean(error?.message || error?.error_data?.details),
          conversationId: clean(status?.conversation?.id),
          pricingCategory: clean(status?.pricing?.category),
          providerTimestamp: clean(status?.timestamp)
        };
      })
    )
  );
}
