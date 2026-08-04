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
  sendCustomEmailCampaign,
  sendEmailCampaign
} from "../../lib/email-campaigns";

function clean(value) {
  return String(value || "").trim();
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(clean(value) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buildConfirmRedirect(formData, errorMessage) {
  const draftId = clean(formData.get("draftId"));
  if (draftId) {
    return `/email/confirm?draft=${encodeURIComponent(draftId)}&error=${encodeURIComponent(clean(errorMessage) || "שליחת המייל נכשלה")}`;
  }

  const params = new URLSearchParams();
  const keys = [
    "q",
    "sendScope",
    "subject",
    "senderName",
    "replyTo",
    "bodyHtml",
    "bodyText",
    "contentHtml",
    "includeGreeting"
  ];

  for (const key of keys) {
    const value = clean(formData.get(key));
    if (value) params.set(key, value);
  }

  for (const key of ["institution", "class", "registration", "familystatus", "recipientRoles"]) {
    for (const value of formData.getAll(key).map(clean).filter(Boolean)) {
      params.append(key, value);
    }
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
    institution: formData.getAll("institution").map(clean).filter(Boolean),
    class: formData.getAll("class").map(clean).filter(Boolean),
    registration: formData.getAll("registration").map(clean).filter(Boolean),
    familystatus: formData.getAll("familystatus").map(clean).filter(Boolean),
    tagIds: formData.getAll("tagIds").map(clean).filter(Boolean),
    q: clean(formData.get("q")),
    recipientRoles: formData.getAll("recipientRoles").map(clean).filter(Boolean),
    sendScope: clean(formData.get("sendScope")) || "selected",
    subject: clean(formData.get("subject")),
    senderName: clean(formData.get("senderName")),
    replyTo: clean(formData.get("replyTo")),
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

export async function createPaymentEmailCampaignConfirmAction(formData) {
  const user = await requireEmailSender();
  const existingDraft = await getEmailCampaignDraft(clean(formData.get("draftId")));
  const nextAttachments = await buildAttachmentsFromForm(formData);
  const preservedAttachments = nextAttachments.length
    ? nextAttachments
    : Array.isArray(existingDraft?.draft_json?.attachments)
      ? existingDraft.draft_json.attachments
      : [];
  const payload = {
    source: "payments",
    reportConfig: {
      reportType: clean(formData.get("reportType")) === "mandates" ? "mandates" : "transactions",
      dateFrom: clean(formData.get("dateFrom")),
      dateTo: clean(formData.get("dateTo")),
      mandateStatus: clean(formData.get("mandateStatus")),
      providers: formData.getAll("provider").map(clean).filter(Boolean),
      connectionIds: formData.getAll("connectionId").map(clean).filter(Boolean),
      searchTerm: clean(formData.get("searchTerm")),
      sortBy: clean(formData.get("sortBy")) || "date",
      sortDir: clean(formData.get("sortDir")) || "desc",
      singleRecipientId: clean(formData.get("singleRecipientId"))
    },
    subject: clean(formData.get("subject")),
    senderName: clean(formData.get("senderName")),
    replyTo: clean(formData.get("replyTo")),
    bodyHtml: clean(formData.get("bodyHtml")),
    bodyText: clean(formData.get("bodyText")),
    includeGreeting: clean(formData.get("includeGreeting")) !== "0",
    sendScope: clean(formData.get("sendScope")) || "selected",
    selectedRecipientIds: formData.getAll("selectedRecipientIds").map(clean).filter(Boolean),
    customRecipients: parseJsonArray(formData.get("customRecipientsJson")),
    attachments: preservedAttachments
  };

  const draftId = await saveEmailCampaignDraft({
    id: clean(formData.get("draftId")),
    createdByUserId: user.clerk_user_id,
    payload
  });

  redirect(`/email/payments/confirm?draft=${encodeURIComponent(draftId)}`);
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

export async function sendPaymentEmailCampaignAction(formData) {
  const user = await requireEmailSender();
  const draftId = clean(formData.get("draftId"));
  if (clean(formData.get("confirmFinalSend")) !== "1") {
    redirect(`/email/payments/confirm?draft=${encodeURIComponent(draftId)}&error=${encodeURIComponent("יש לאשר שליחה סופית לפני הביצוע.")}`);
  }

  const draftRecord = await getEmailCampaignDraft(draftId);
  const draft = draftRecord?.draft_json || null;
  if (!draft) {
    redirect("/email/payments?error=" + encodeURIComponent("טיוטת המייל לא נמצאה. יש ליצור אישור חדש."));
  }

  const claim = await claimEmailCampaignDraftForSend(draftId);
  if (!claim.ok) {
    if (claim.status === "already-sent") {
      const params = new URLSearchParams({
        campaignId: claim.campaignId || "",
        notice: "המייל כבר נשלח קודם. נמנעה שליחה כפולה."
      });
      redirect(`/email/payments?${params.toString()}`);
    }
    if (claim.status === "sending") {
      redirect(`/email/payments?notice=${encodeURIComponent("המייל כבר נמצא בתהליך שליחה. אין צורך ללחוץ שוב.")}`);
    }
    redirect(`/email/payments?error=${encodeURIComponent("טיוטת השליחה אינה זמינה יותר. יש ליצור אישור חדש.")}`);
  }

  let result = null;
  try {
    result = await sendCustomEmailCampaign({
      draft: { ...draft, draftId },
      createdByUserId: user.clerk_user_id,
      permissions: {
        canEditEmailSender: user.can_edit_email_sender
      }
    });
  } catch (error) {
    await releaseEmailCampaignDraftSendClaim(draftId);
    redirect(`/email/payments/confirm?draft=${encodeURIComponent(draftId)}&error=${encodeURIComponent(clean(error?.message) || "שליחת המייל נכשלה")}`);
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
  redirect(`/email/payments?${params.toString()}`);
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
  if (clean(filters.source) === "payments") {
    const payload = {
      source: "payments",
      reportConfig: filters.reportConfig && typeof filters.reportConfig === "object" ? filters.reportConfig : {},
      customRecipients: Array.isArray(filters.customRecipients) ? filters.customRecipients : [],
      selectedRecipientIds: Array.isArray(filters.selectedRecipientIds) ? filters.selectedRecipientIds.map(clean).filter(Boolean) : [],
      sendScope: clean(filters.sendScope || campaign.send_scope) || "selected",
      subject: clean(campaign.subject),
      senderName: clean(campaign.sender_name),
      replyTo: clean(campaign.reply_to),
      bodyHtml: clean(campaign.body_html),
      bodyText: clean(campaign.body_text),
      includeGreeting: campaign.include_greeting !== false
    };

    const draftId = await saveEmailCampaignDraft({
      createdByUserId: user.clerk_user_id,
      payload
    });

    redirect(`/email/payments?draft=${encodeURIComponent(draftId)}&reopened=1`);
  }

  const payload = {
    institution: Array.isArray(filters.institution) ? filters.institution.map(clean).filter(Boolean) : clean(filters.institution || campaign.institution) ? [clean(filters.institution || campaign.institution)] : [],
    class: Array.isArray(filters.class) ? filters.class.map(clean).filter(Boolean) : clean(filters.class || campaign.class_filter) ? [clean(filters.class || campaign.class_filter)] : [],
    registration: Array.isArray(filters.registration) ? filters.registration.map(clean).filter(Boolean) : clean(filters.registration) ? [clean(filters.registration)] : [],
    familystatus: Array.isArray(filters.familystatus) ? filters.familystatus.map(clean).filter(Boolean) : clean(filters.familystatus) ? [clean(filters.familystatus)] : [],
    tagIds: Array.isArray(filters.tagIds) ? filters.tagIds.map(clean).filter(Boolean) : [],
    q: clean(filters.q),
    recipientRoles: Array.isArray(filters.recipientRoles)
      ? filters.recipientRoles.map(clean).filter(Boolean)
      : clean(filters.recipientMode || campaign.recipient_mode)
        ? [clean(filters.recipientMode || campaign.recipient_mode)]
        : ["father", "mother"],
    sendScope: clean(filters.sendScope || campaign.send_scope) || "selected",
    selectedStudentIds: Array.isArray(filters.selectedStudentIds) ? filters.selectedStudentIds.map(clean).filter(Boolean) : [],
    subject: clean(campaign.subject),
    senderName: clean(campaign.sender_name),
    replyTo: clean(campaign.reply_to),
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
