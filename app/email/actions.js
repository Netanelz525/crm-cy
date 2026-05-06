"use server";

import { redirect } from "next/navigation";
import { requireEmailSender } from "../../lib/rbac";
import { sendEmailCampaign } from "../../lib/email-campaigns";

function clean(value) {
  return String(value || "").trim();
}

export async function sendEmailCampaignAction(formData) {
  const user = await requireEmailSender();
  let result = null;
  try {
    result = await sendEmailCampaign({
      formData,
      createdByUserId: user.clerk_user_id,
      permissions: {
        canEditEmailSender: user.can_edit_email_sender,
        canEmailParents: user.can_email_parents
      }
    });
  } catch (error) {
    redirect(`/email?error=${encodeURIComponent(clean(error?.message) || "שליחת המייל נכשלה")}`);
  }

  const params = new URLSearchParams({
    sent: String(result.sent),
    failed: String(result.failed),
    skipped: String(result.skipped),
    campaignId: result.campaignId
  });
  redirect(`/email?${params.toString()}`);
}
