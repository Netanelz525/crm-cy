"use server";

import { redirect } from "next/navigation";
import { requireEmailSender } from "../../lib/rbac";
import { saveEmailCampaignDraft, sendEmailCampaign } from "../../lib/email-campaigns";

function clean(value) {
  return String(value || "").trim();
}

function buildConfirmRedirect(formData, errorMessage) {
  const draftId = clean(formData.get("draftId"));
  if (draftId) {
    return `/email/confirm?draft=${encodeURIComponent(draftId)}&error=${encodeURIComponent(clean(errorMessage) || "שליחת המייל נכשלה")}`;
  }

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

export async function createEmailCampaignConfirmAction(formData) {
  const user = await requireEmailSender();
  const payload = {
    institution: clean(formData.get("institution")),
    class: clean(formData.get("class")),
    registration: clean(formData.get("registration")),
    familystatus: clean(formData.get("familystatus")),
    q: clean(formData.get("q")),
    recipientMode: clean(formData.get("recipientMode")) || "parents",
    sendScope: clean(formData.get("sendScope")) || "selected",
    subject: clean(formData.get("subject")),
    senderName: clean(formData.get("senderName")),
    bodyHtml: clean(formData.get("contentHtml")) || clean(formData.get("bodyHtml")),
    bodyText: clean(formData.get("bodyText")),
    includeGreeting: clean(formData.get("includeGreeting")) !== "0",
    selectedStudentIds: formData.getAll("studentIds").map(clean).filter(Boolean)
  };

  const draftId = await saveEmailCampaignDraft({
    id: clean(formData.get("draftId")),
    createdByUserId: user.clerk_user_id,
    payload
  });

  redirect(`/email/confirm?draft=${encodeURIComponent(draftId)}`);
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
