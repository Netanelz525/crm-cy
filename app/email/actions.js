"use server";

import { redirect } from "next/navigation";
import { requireEmailSender } from "../../lib/rbac";
import { sendEmailCampaign } from "../../lib/email-campaigns";

function clean(value) {
  return String(value || "").trim();
}

function buildConfirmRedirect(formData, errorMessage) {
  const params = new URLSearchParams();
  const keys = [
    "institution",
    "class",
    "registration",
    "familystatus",
    "q",
    "recipientMode",
    "sendScope",
    "subject",
    "senderName",
    "bodyHtml",
    "bodyText",
    "contentHtml",
    "includeGreeting"
  ];

  for (const key of keys) {
    const value = clean(formData.get(key));
    if (value) params.set(key, value);
  }

  for (const studentId of formData.getAll("studentIds").map(clean).filter(Boolean)) {
    params.append("studentIds", studentId);
  }

  params.set("error", clean(errorMessage) || "שליחת המייל נכשלה");
  return `/email/confirm?${params.toString()}`;
}

export async function sendEmailCampaignAction(formData) {
  const user = await requireEmailSender();
  if (clean(formData.get("confirmFinalSend")) !== "1") {
    redirect(buildConfirmRedirect(formData, "יש לאשר שליחה סופית לפני הביצוע."));
  }

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
    redirect(buildConfirmRedirect(formData, clean(error?.message) || "שליחת המייל נכשלה"));
  }

  const params = new URLSearchParams({
    sent: String(result.sent),
    failed: String(result.failed),
    skipped: String(result.skipped),
    campaignId: result.campaignId
  });
  redirect(`/email?${params.toString()}`);
}
