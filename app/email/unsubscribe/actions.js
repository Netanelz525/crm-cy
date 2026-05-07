"use server";

import { redirect } from "next/navigation";
import { unsubscribeEmailByDeliveryId } from "../../../lib/email-campaigns";

function clean(value) {
  return String(value || "").trim();
}

export async function confirmEmailUnsubscribeAction(formData) {
  const deliveryId = clean(formData.get("delivery"));
  if (!deliveryId) {
    redirect("/email/unsubscribe?error=" + encodeURIComponent("קישור ההסרה אינו תקין."));
  }

  try {
    await unsubscribeEmailByDeliveryId(deliveryId);
  } catch (error) {
    redirect(`/email/unsubscribe?delivery=${encodeURIComponent(deliveryId)}&error=${encodeURIComponent(clean(error?.message) || "ההסרה נכשלה.")}`);
  }

  redirect(`/email/unsubscribe?delivery=${encodeURIComponent(deliveryId)}&done=1`);
}
