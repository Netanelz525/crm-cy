"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { dispatchEmailCampaign, sendEmailCampaign } from "../lib/email-campaigns";
import { requireEmailSender } from "../lib/rbac";

function clean(value) {
  return String(value || "").trim();
}

function appendMessage(url, key, value) {
  const target = clean(url) || "/neon";
  const separator = target.includes("?") ? "&" : "?";
  return `${target}${separator}${key}=${encodeURIComponent(clean(value))}`;
}

export async function sendQuickStudentEmailAction(formData) {
  const user = await requireEmailSender();
  const returnTo = clean(formData.get("returnTo")) || "/neon";
  const studentId = clean(formData.get("studentId"));
  const subject = clean(formData.get("subject"));
  const bodyText = clean(formData.get("bodyText"));
  const senderName = clean(formData.get("senderName"));
  const includeGreeting = clean(formData.get("includeGreeting")) === "1";
  const recipientRoles = formData.getAll("recipientRoles").map(clean).filter(Boolean);

  if (!studentId) redirect(appendMessage(returnTo, "quickEmailError", "לא נבחר תלמיד לשליחה."));
  if (!recipientRoles.length) redirect(appendMessage(returnTo, "quickEmailError", "יש לבחור לפחות נמען אחד: אבא, אמא או תלמיד."));
  if (!subject) redirect(appendMessage(returnTo, "quickEmailError", "יש להזין נושא למייל."));
  if (!bodyText) redirect(appendMessage(returnTo, "quickEmailError", "יש להזין תוכן למייל."));

  const campaignForm = new FormData();
  campaignForm.set("sendScope", "selected");
  campaignForm.set("subject", subject);
  campaignForm.set("bodyText", bodyText);
  campaignForm.set("senderName", senderName);
  campaignForm.set("includeGreeting", includeGreeting ? "1" : "0");
  campaignForm.append("studentIds", studentId);
  recipientRoles.forEach((role) => campaignForm.append("recipientRoles", role));

  let result = null;
  try {
    result = await sendEmailCampaign({
      formData: campaignForm,
      createdByUserId: user.clerk_user_id,
      permissions: {
        canEditEmailSender: user.can_edit_email_sender,
        canEmailParents: user.can_email_parents
      }
    });
  } catch (error) {
    redirect(appendMessage(returnTo, "quickEmailError", clean(error?.message) || "שליחת המייל נכשלה."));
  }

  after(async () => {
    try {
      await dispatchEmailCampaign(result);
    } catch {
      // Delivery status is saved on the campaign rows when background sending fails.
    }
  });

  redirect(appendMessage(returnTo, "quickEmailSent", "1"));
}
