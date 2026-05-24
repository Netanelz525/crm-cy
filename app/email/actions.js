"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireEmailSender } from "../../lib/rbac";
import {
  addEmailUnsubscribe,
  addFavoriteEmailCampaign,
  buildAttachmentsFromForm,
  claimEmailCampaignDraftForSend,
  dispatchEmailCampaign,
  finalizeEmailCampaignDraftSend,
  getEmailCampaignById,
  getEmailCampaignDraft,
  releaseEmailCampaignDraftSendClaim,
  removeFavoriteEmailCampaign,
  removeEmailUnsubscribe,
  saveEmailCampaignDraft,
  sendEmailCampaign
} from "../../lib/email-campaigns";

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
  for (const tagId of formData.getAll("tagIds").map(clean).filter(Boolean)) {
    params.append("tagIds", tagId);
  }

  params.set("error", clean(errorMessage) || "שליחת המייל נכשלה");
  return `/email/confirm?${params.toString()}`;
}

export async function createEmailCampaignConfirmAction(formData) {
  const user = await requireEmailSender();
  const existingDraft = await getEmailCampaignDraft(clean(formData.get("draftId")));
  const nextAttachments = await buildAttachmentsFromForm(formData);
  const preservedAttachments = nextAttachments.length
    ? nextAttachments
    : Array.isArray(existingDraft?.draft_json?.attachments)
      ? existingDraft.draft_json.attachments
      : [];
  const payload = {
    institution: clean(formData.get("institution")),
    class: clean(formData.get("class")),
    registration: clean(formData.get("registration")),
    familystatus: clean(formData.get("familystatus")),
    tagIds: formData.getAll("tagIds").map(clean).filter(Boolean),
    q: clean(formData.get("q")),
    recipientMode: clean(formData.get("recipientMode")) || "parents",
    sendScope: clean(formData.get("sendScope")) || "selected",
    subject: clean(formData.get("subject")),
    senderName: clean(formData.get("senderName")),
    bodyHtml: clean(formData.get("contentHtml")) || clean(formData.get("bodyHtml")),
    bodyText: clean(formData.get("bodyText")),
    includeGreeting: clean(formData.get("includeGreeting")) !== "0",
    selectedStudentIds: formData.getAll("studentIds").map(clean).filter(Boolean),
    attachments: preservedAttachments
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
  const draftId = clean(formData.get("draftId"));
  if (clean(formData.get("confirmFinalSend")) !== "1") {
    redirect(buildConfirmRedirect(formData, "יש לאשר שליחה סופית לפני הביצוע."));
  }

  const claim = await claimEmailCampaignDraftForSend(draftId);
  if (!claim.ok) {
    if (claim.status === "already-sent") {
      const params = new URLSearchParams({
        campaignId: claim.campaignId || "",
        notice: "המייל כבר נשלח קודם. נמנעה שליחה כפולה."
      });
      redirect(`/email?${params.toString()}`);
    }
    if (claim.status === "sending") {
      redirect(`/email?notice=${encodeURIComponent("המייל כבר נמצא בתהליך שליחה. אין צורך ללחוץ שוב.")}`);
    }
    redirect(buildConfirmRedirect(formData, "טיוטת השליחה אינה זמינה יותר. יש לפתוח אישור חדש."));
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
    await releaseEmailCampaignDraftSendClaim(draftId);
    redirect(buildConfirmRedirect(formData, clean(error?.message) || "שליחת המייל נכשלה"));
  }

  after(async () => {
    try {
      await dispatchEmailCampaign(result);
      await finalizeEmailCampaignDraftSend(draftId, result.campaignId);
    } catch (_error) {
      await releaseEmailCampaignDraftSendClaim(draftId);
    }
  });

  const params = new URLSearchParams({
    campaignId: result.campaignId,
    notice: "השליחה התחילה ותושלם ברקע. אפשר לסגור את הדף."
  });
  redirect(`/email?${params.toString()}`);
}

export async function addEmailUnsubscribeAction(formData) {
  await requireEmailSender();
  const email = clean(formData.get("recipientEmail"));
  const recipientName = clean(formData.get("recipientName"));
  const reasonText = clean(formData.get("reasonText"));

  try {
    await addEmailUnsubscribe({ email, recipientName, reasonText });
  } catch (error) {
    redirect(`/email?error=${encodeURIComponent(clean(error?.message) || "הוספת הכתובת לרשימה השחורה נכשלה")}`);
  }

  redirect("/email?blacklistUpdated=1");
}

export async function removeEmailUnsubscribeAction(formData) {
  await requireEmailSender();
  const email = clean(formData.get("recipientEmail"));

  try {
    await removeEmailUnsubscribe(email);
  } catch (error) {
    redirect(`/email?error=${encodeURIComponent(clean(error?.message) || "הסרת הכתובת מהרשימה השחורה נכשלה")}`);
  }

  redirect("/email?blacklistUpdated=1");
}

export async function reopenEmailCampaignAction(formData) {
  const user = await requireEmailSender();
  const campaignId = clean(formData.get("campaignId"));
  const campaign = await getEmailCampaignById(campaignId);
  if (!campaign) {
    redirect(`/email/campaigns?error=${encodeURIComponent("קמפיין המייל לא נמצא")}`);
  }

  const filters = campaign.filter_json && typeof campaign.filter_json === "object" ? campaign.filter_json : {};
  const payload = {
    institution: clean(filters.institution || campaign.institution),
    class: clean(filters.class || campaign.class_filter),
    registration: clean(filters.registration),
    familystatus: clean(filters.familystatus),
    tagIds: Array.isArray(filters.tagIds) ? filters.tagIds.map(clean).filter(Boolean) : [],
    q: clean(filters.q),
    recipientMode: clean(filters.recipientMode || campaign.recipient_mode) || "parents",
    sendScope: clean(filters.sendScope || campaign.send_scope) || "selected",
    selectedStudentIds: Array.isArray(filters.selectedStudentIds) ? filters.selectedStudentIds.map(clean).filter(Boolean) : [],
    subject: clean(campaign.subject),
    senderName: clean(campaign.sender_name),
    bodyHtml: clean(campaign.body_html),
    bodyText: clean(campaign.body_text),
    includeGreeting: campaign.include_greeting !== false
  };

  const draftId = await saveEmailCampaignDraft({
    createdByUserId: user.clerk_user_id,
    payload
  });

  redirect(`/email?draft=${encodeURIComponent(draftId)}&reopened=1`);
}

export async function saveFavoriteEmailCampaignAction(formData) {
  const user = await requireEmailSender();
  const campaignId = clean(formData.get("campaignId"));
  const returnTo = clean(formData.get("returnTo")) || `/email/campaigns/${encodeURIComponent(campaignId)}`;

  try {
    await addFavoriteEmailCampaign({
      clerkUserId: user.clerk_user_id,
      campaignId,
      label: clean(formData.get("label"))
    });
  } catch (error) {
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=${encodeURIComponent(clean(error?.message) || "שמירת המועדף נכשלה")}`);
  }

  redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}favoriteSaved=1`);
}

export async function removeFavoriteEmailCampaignAction(formData) {
  const user = await requireEmailSender();
  const campaignId = clean(formData.get("campaignId"));
  const returnTo = clean(formData.get("returnTo")) || `/email/campaigns/${encodeURIComponent(campaignId)}`;

  try {
    await removeFavoriteEmailCampaign({
      clerkUserId: user.clerk_user_id,
      campaignId
    });
  } catch (error) {
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=${encodeURIComponent(clean(error?.message) || "הסרת המועדף נכשלה")}`);
  }

  redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}favoriteRemoved=1`);
}
