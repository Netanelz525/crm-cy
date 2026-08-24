"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import {
  buildAttachmentsFromForm,
  dispatchEmailCampaign,
  sendCustomEmailCampaign
} from "../../lib/email-campaigns";
import { requireEmailSender, requireSuperAdmin } from "../../lib/rbac";
import { runMonthlyPaymentStudentLinking } from "../../lib/monthly-payment-student-linking";

function clean(value) {
  return String(value || "").trim();
}

export async function runPaymentStudentLinkingAction(formData) {
  await requireSuperAdmin();
  const periodMonth = clean(formData.get("periodMonth")) || "2026-07";
  let result;
  try {
    result = await runMonthlyPaymentStudentLinking({ periodMonth, force: true });
  } catch (error) {
    redirect(`/payments?linkingError=${encodeURIComponent(error?.message || "הרצת השיוך נכשלה")}`);
  }
  revalidatePath("/payments");
  redirect(`/payments?linkingCompleted=1&linkingMonth=${encodeURIComponent(periodMonth)}&linked=${result?.autoLinked || 0}`);
}

function appendMessage(url, key, value) {
  const target = clean(url) || "/payments";
  const separator = target.includes("?") ? "&" : "?";
  return `${target}${separator}${key}=${encodeURIComponent(clean(value))}`;
}

export async function sendSinglePaymentMandateEmailAction(formData) {
  const user = await requireEmailSender();
  const returnTo = clean(formData.get("returnTo")) || "/payments?reportType=mandates&run=1";
  const recipientEmail = clean(formData.get("recipientEmail")).toLowerCase();
  const recipientName = clean(formData.get("recipientName")) || recipientEmail;
  const subject = clean(formData.get("subject"));
  const senderName = clean(formData.get("senderName"));
  const replyTo = clean(formData.get("replyTo"));
  const bodyText = clean(formData.get("bodyText"));

  if (!recipientEmail) redirect(appendMessage(returnTo, "error", "לרשומה הזו אין כתובת מייל לשליחה."));
  if (!subject) redirect(appendMessage(returnTo, "error", "יש להזין נושא למייל."));
  if (!bodyText) redirect(appendMessage(returnTo, "error", "יש להזין תוכן למייל."));

  let attachments = [];
  try {
    attachments = await buildAttachmentsFromForm(formData);
  } catch (error) {
    redirect(appendMessage(returnTo, "error", clean(error?.message) || "צירוף הקובץ נכשל."));
  }

  let result = null;
  try {
    result = await sendCustomEmailCampaign({
      draft: {
        source: "payments",
        reportConfig: {
          reportType: "mandates",
          singleRecipientId: recipientEmail
        },
        customRecipients: [{
          id: recipientEmail,
          email: recipientEmail,
          name: recipientName,
          sourceLabel: clean(formData.get("sourceLabel")),
          providerLabel: clean(formData.get("providerLabel")),
          extraLabel: clean(formData.get("extraLabel"))
        }],
        selectedRecipientIds: [recipientEmail],
        sendScope: "selected",
        subject,
        senderName,
        replyTo,
        bodyText,
        bodyHtml: "",
        includeGreeting: true,
        attachments
      },
      createdByUserId: user.clerk_user_id,
      permissions: {
        canEditEmailSender: user.can_edit_email_sender
      }
    });
  } catch (error) {
    redirect(appendMessage(returnTo, "error", clean(error?.message) || "שליחת המייל נכשלה."));
  }

  after(async () => {
    try {
      await dispatchEmailCampaign(result);
    } catch {
      // The campaign delivery row keeps the failure details when dispatch fails.
    }
  });

  redirect(appendMessage(returnTo, "notice", "המייל נשלח לתור השליחה ויישלח ברקע."));
}
