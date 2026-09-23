"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import {
  createAttendanceSession,
  deleteAttendanceSession,
  getAttendanceSessionById,
  normalizeAttendanceSessionType,
  parseAttendanceCustomStatusesFields,
  parseAttendanceCustomStatusesText,
  saveAttendanceRecord,
  setAttendanceSessionManualStudent,
  setAttendanceSessionLocked,
  syncAttendanceSessionStudents,
  updateAttendanceSessionManualStudents,
  updateAttendanceSessionCustomStatuses,
  updateAttendanceSessionDetails,
  updateAttendanceSessionInvitation,
  updateAttendanceSessionMessaging
} from "../../lib/attendance";
import { sendAttendanceSessionEmails } from "../../lib/attendance-email";
import { sendAttendanceInvitation } from "../../lib/attendance-invitations";
import { uploadBufferToR2 } from "../../lib/r2";
import { listWhatsAppCoexistenceApprovedTemplates, sendAttendanceSessionWhatsApp, sendAttendanceSessionWhatsAppApprovedTemplate, uploadAttendanceWhatsAppImage } from "../../lib/attendance-whatsapp";
import { requireAttendanceUser, requireEmailSender } from "../../lib/rbac";

function clean(value) {
  return String(value || "").trim();
}

function cleanList(values) {
  return (Array.isArray(values) ? values : [values]).map(clean).filter(Boolean);
}

function safeFileName(value) {
  return clean(value).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "attachment";
}

export async function createAttendanceSessionAction(formData) {
  const user = await requireAttendanceUser();
  const canUseSessionAudienceFilters = true;
  const institution = clean(formData.get("institution"));
  const sessionType = clean(formData.get("sessionType"));
  const templateSessionId = clean(formData.get("templateSessionId"));
  const templateSession = templateSessionId ? await getAttendanceSessionById(templateSessionId) : null;
  const title = clean(formData.get("title"));
  const sessionDate = clean(formData.get("sessionDate"));
  if (!normalizeAttendanceSessionType(sessionType || templateSession?.sessionType)) {
    return { error: "בחר סוג מפגש או מבנה ממפגש קודם לפני יצירת מפגש." };
  }
  const parsedDate = new Date(`${sessionDate}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== sessionDate) {
    return { error: "בחר תאריך תקין למפגש." };
  }
  const sourceNote = clean(formData.get("sourceNote"));
  const institutionFilter = canUseSessionAudienceFilters ? cleanList(formData.getAll("institutionFilter")) : [];
  const classFilter = canUseSessionAudienceFilters ? cleanList(formData.getAll("classFilter")) : [];
  const registrationFilter = canUseSessionAudienceFilters ? cleanList(formData.getAll("registrationFilter")) : [];
  const familyStatusFilter = canUseSessionAudienceFilters ? cleanList(formData.getAll("familyStatusFilter")) : [];
  const tagFilter = canUseSessionAudienceFilters ? cleanList(formData.getAll("tagFilter")) : [];
  const manualStudentIds = canUseSessionAudienceFilters ? cleanList(formData.getAll("manualStudentIds")) : [];
  const requestedRosterMode = clean(formData.get("rosterMode"));
  const responsibleUserIds = cleanList(formData.getAll("responsibleUserIds"));

  const session = await createAttendanceSession({
    id: crypto.randomUUID(),
    institution: institution || templateSession?.institution || "",
    sessionType: sessionType || templateSession?.sessionType,
    title: title || (templateSession ? `${templateSession.displayTitle || templateSession.title || templateSession.sessionTypeLabel} - חדש` : ""),
    sessionDate,
    sourceNote: sourceNote || templateSession?.sourceNote || "",
    communicationAudience: clean(formData.get("communicationAudience")) || templateSession?.communicationAudience || "student",
    emailSubject: templateSession?.emailSubject || "",
    personalMessage: templateSession?.personalMessage || "",
    customStatuses: templateSession?.customStatuses || [],
    emailResponseStatuses: templateSession?.emailResponseStatuses || [],
    emailRecipientRoles: templateSession?.emailRecipientRoles || [],
    invitationEmailSubject: templateSession?.invitationEmailSubject || "",
    invitationEmailBody: templateSession?.invitationEmailBody || "",
    invitationEmailRecipientRoles: templateSession?.invitationEmailRecipientRoles || [],
    invitationWhatsAppTemplateName: templateSession?.invitationWhatsAppTemplateName || "",
    invitationWhatsAppTemplateLanguage: templateSession?.invitationWhatsAppTemplateLanguage || "he",
    invitationWhatsAppRecipientRoles: templateSession?.invitationWhatsAppRecipientRoles || ["student"],
    invitationAttachmentObjectKey: templateSession?.invitationAttachment?.objectKey || "",
    invitationAttachmentFileName: templateSession?.invitationAttachment?.fileName || "",
    invitationAttachmentContentType: templateSession?.invitationAttachment?.contentType || "",
    invitationAttachmentSizeBytes: templateSession?.invitationAttachment?.sizeBytes || 0,
    institutionFilter: institutionFilter.length ? institutionFilter : (templateSession?.institutionFilter || []),
    classFilter: classFilter.length ? classFilter : (templateSession?.classFilter || []),
    registrationFilter: registrationFilter.length ? registrationFilter : (templateSession?.registrationFilter || []),
    familyStatusFilter: familyStatusFilter.length ? familyStatusFilter : (templateSession?.familyStatusFilter || []),
    tagFilter: tagFilter.length ? tagFilter : (templateSession?.tagFilter || []),
    manualStudentIds: manualStudentIds.length ? manualStudentIds : (templateSession?.manualStudentIds || []),
    rosterMode: requestedRosterMode || templateSession?.rosterMode || (institutionFilter.length || classFilter.length || registrationFilter.length || familyStatusFilter.length ? "filters" : "manual"),
    responsibleUserIds: responsibleUserIds.length ? responsibleUserIds : (templateSession?.responsibleUserIds?.length ? templateSession.responsibleUserIds : [user.clerk_user_id]),
    visibleToStudents: templateSession ? Boolean(templateSession.visibleToStudents) : (canUseSessionAudienceFilters && clean(formData.get("visibleToStudents")) === "1"),
    createdByUserId: user.clerk_user_id
  });

  revalidatePath("/attendance");
  revalidatePath(`/attendance/${session.id}`);
  redirect(`/attendance/${session.id}?created=1`);
}

export async function saveAttendanceSessionDetailsAction(formData) {
  const user = await requireAttendanceUser();
  const canManageSessionSettings = user.is_manager || user.is_super_admin;
  const sessionId = clean(formData.get("sessionId"));
  if (!sessionId) throw new Error("Missing attendance session id.");

  await updateAttendanceSessionDetails(sessionId, {
    title: clean(formData.get("title")),
    sessionType: clean(formData.get("sessionType")),
    sessionDate: clean(formData.get("sessionDate")),
    sourceNote: clean(formData.get("sourceNote")),
    communicationAudience: clean(formData.get("communicationAudience")),
    ...(canManageSessionSettings ? {
      responsibleUserIds: cleanList(formData.getAll("responsibleUserIds")),
      visibleToStudents: clean(formData.get("visibleToStudents")) === "1"
    } : {})
  });

  revalidatePath("/attendance");
  revalidatePath(`/attendance/${sessionId}`);
  redirect(`/attendance/${sessionId}?detailsSaved=1`);
}

export async function saveAttendanceRecordAction(input) {
  const user = await requireAttendanceUser();
  const payload = input instanceof FormData
    ? {
        sessionId: clean(input.get("sessionId")),
        studentId: clean(input.get("studentId")),
        studentName: clean(input.get("studentName")),
        studentClass: clean(input.get("studentClass")),
        status: clean(input.get("status")),
        noteText: clean(input.get("noteText"))
      }
    : {
        sessionId: clean(input?.sessionId),
        studentId: clean(input?.studentId),
        studentName: clean(input?.studentName),
        studentClass: clean(input?.studentClass),
        status: clean(input?.status),
        noteText: clean(input?.noteText)
      };

  await saveAttendanceRecord({
    sessionId: payload.sessionId,
    record: {
      studentId: payload.studentId,
      studentName: payload.studentName,
      studentClass: payload.studentClass,
      status: payload.status,
      noteText: payload.noteText
    },
    markedByUserId: user.clerk_user_id
  });

  return { ok: true };
}

export async function setAttendanceSessionLockAction(formData) {
  const user = await requireAttendanceUser();
  if (!user.is_manager && !user.is_super_admin) redirect("/unauthorized");
  const sessionId = clean(formData.get("sessionId"));
  const locked = clean(formData.get("locked")) === "1";
  const requestedReturnPath = clean(formData.get("returnPath"));
  const returnPath = requestedReturnPath.startsWith("/attendance") ? requestedReturnPath : "";
  if (!sessionId) throw new Error("Missing attendance session id.");

  await setAttendanceSessionLocked(sessionId, {
    locked,
    lockedByUserId: user.clerk_user_id
  });

  revalidatePath("/attendance");
  revalidatePath(`/attendance/${sessionId}`);
  if (returnPath) {
    const separator = returnPath.includes("?") ? "&" : "?";
    redirect(`${returnPath}${separator}lockSaved=${locked ? "locked" : "unlocked"}`);
  }
  redirect(`/attendance/${sessionId}?lockSaved=${locked ? "locked" : "unlocked"}`);
}

export async function setAttendanceSessionsBulkLockAction(formData) {
  const user = await requireAttendanceUser();
  if (!user.is_manager && !user.is_super_admin) redirect("/unauthorized");
  const sessionIds = cleanList(formData.getAll("sessionIds"));
  const locked = clean(formData.get("locked")) === "1";
  const requestedReturnPath = clean(formData.get("returnPath"));
  const returnPath = requestedReturnPath.startsWith("/attendance") ? requestedReturnPath : "/attendance";

  for (const sessionId of sessionIds) {
    await setAttendanceSessionLocked(sessionId, {
      locked,
      lockedByUserId: user.clerk_user_id
    });
    revalidatePath(`/attendance/${sessionId}`);
  }

  revalidatePath("/attendance");
  const separator = returnPath.includes("?") ? "&" : "?";
  redirect(`${returnPath}${separator}bulkLockSaved=${locked ? "locked" : "unlocked"}&bulkLockCount=${sessionIds.length}`);
}

export async function deleteAttendanceSessionAction(formData) {
  await requireAttendanceUser();
  const sessionId = clean(formData.get("sessionId"));
  const currentSessionId = clean(formData.get("currentSessionId"));

  await deleteAttendanceSession(sessionId);

  revalidatePath("/attendance");
  if (currentSessionId && currentSessionId !== sessionId) redirect(`/attendance/${currentSessionId}`);
  redirect("/attendance?deleted=1");
}

export async function syncAttendanceSessionStudentsAction(formData) {
  await requireAttendanceUser();
  const sessionId = clean(formData.get("sessionId"));
  if (!sessionId) throw new Error("Missing attendance session id.");

  await syncAttendanceSessionStudents(sessionId);

  revalidatePath(`/attendance/${sessionId}`);
  redirect(`/attendance/${sessionId}?synced=1`);
}

export async function saveAttendanceSessionStatusesAction(formData) {
  await requireAttendanceUser();
  const sessionId = clean(formData.get("sessionId"));
  const customStatuses = formData.has("customStatusApi")
    ? parseAttendanceCustomStatusesFields(formData.getAll("customStatusApi"), formData.getAll("customStatusLabel"))
    : parseAttendanceCustomStatusesText(formData.get("customStatusesText"));
  if (!sessionId) throw new Error("Missing attendance session id.");

  await updateAttendanceSessionCustomStatuses(sessionId, {
    customStatuses
  });

  revalidatePath(`/attendance/${sessionId}`);
  redirect(`/attendance/${sessionId}?statusesSaved=1`);
}

export async function saveAttendanceSessionMessagingAction(formData) {
  await requireAttendanceUser();
  const sessionId = clean(formData.get("sessionId"));
  const emailSubject = clean(formData.get("emailSubject"));
  const personalMessage = clean(formData.get("personalMessage"));
  const emailResponseStatuses = cleanList(formData.getAll("emailResponseStatuses"));
  const emailRecipientRoles = cleanList(formData.getAll("emailRecipientRoles"));
  if (!sessionId) throw new Error("Missing attendance session id.");

  await updateAttendanceSessionMessaging(sessionId, {
    emailSubject,
    personalMessage,
    emailResponseStatuses,
    emailRecipientRoles
  });

  revalidatePath(`/attendance/${sessionId}`);
  redirect(`/attendance/${sessionId}?messageSaved=1`);
}

export async function saveAttendanceSessionInvitationAction(formData) {
  await requireAttendanceUser();
  const sessionId = clean(formData.get("sessionId"));
  if (!sessionId) throw new Error("Missing attendance session id.");
  const file = formData.get("invitationAttachment");
  let attachment = null;
  if (file && typeof file.arrayBuffer === "function" && file.size) {
    const contentType = clean(file.type).toLowerCase();
    if (!["image/jpeg", "image/png", "application/pdf"].includes(contentType)) {
      redirect(`/attendance/${sessionId}?invitationError=${encodeURIComponent("אפשר לצרף JPG, PNG או PDF בלבד")}`);
    }
    if (file.size > 30 * 1024 * 1024) {
      redirect(`/attendance/${sessionId}?invitationError=${encodeURIComponent("גודל הקובץ המרבי הוא 30MB")}`);
    }
    const fileName = safeFileName(file.name);
    const key = `attendance-invitations/${sessionId}/${crypto.randomUUID()}-${fileName}`;
    await uploadBufferToR2({ key, buffer: Buffer.from(await file.arrayBuffer()), contentType });
    attachment = { objectKey: key, fileName, contentType, sizeBytes: file.size };
  }
  await updateAttendanceSessionInvitation(sessionId, {
    emailSubject: clean(formData.get("invitationEmailSubject")),
    emailBody: clean(formData.get("invitationEmailBody")),
    emailRecipientRoles: cleanList(formData.getAll("invitationEmailRecipientRoles")),
    whatsappTemplateName: clean(formData.get("invitationWhatsAppTemplateName")),
    whatsappTemplateLanguage: clean(formData.get("invitationWhatsAppTemplateLanguage")) || "he",
    whatsappRecipientRoles: cleanList(formData.getAll("invitationWhatsAppRecipientRoles")),
    attachment,
    removeAttachment: clean(formData.get("removeInvitationAttachment")) === "1"
  });
  revalidatePath(`/attendance/${sessionId}`);
  redirect(`/attendance/${sessionId}?invitationSaved=1`);
}

export async function sendAttendanceInvitationAction(formData) {
  await requireAttendanceUser();
  const sessionId = clean(formData.get("sessionId"));
  const channels = cleanList(formData.getAll("invitationChannels"));
  if (!sessionId) throw new Error("Missing attendance session id.");
  if (!channels.length) redirect(`/attendance/${sessionId}?invitationError=${encodeURIComponent("בחר ערוץ שליחה")}`);
  after(async () => {
    try {
      await sendAttendanceInvitation({ sessionId, channels });
    } catch (error) {
      console.error("Attendance invitation send failed", { sessionId, error: error?.message || error });
    } finally {
      revalidatePath(`/attendance/${sessionId}`);
    }
  });
  redirect(`/attendance/${sessionId}?invitationQueued=1`);
}

export async function sendAttendanceSessionEmailsAction(formData) {
  const user = await requireEmailSender();
  const sessionId = clean(formData.get("sessionId"));
  const emailSubject = clean(formData.get("emailSubject"));
  const personalMessage = clean(formData.get("personalMessage"));
  const emailResponseStatuses = cleanList(formData.getAll("emailResponseStatuses"));
  const emailRecipientRoles = cleanList(formData.getAll("emailRecipientRoles"));
  const targetStatuses = cleanList(formData.getAll("targetStatuses"));
  if (!sessionId) throw new Error("Missing attendance session id.");

  try {
    if (!emailSubject) throw new Error("יש להזין נושא מייל לפני שליחת מיילים.");
    if (!personalMessage) throw new Error("יש להזין הודעה אישית לפני שליחת מיילים.");
    if (!emailResponseStatuses.length) throw new Error("יש לבחור לפחות סטטוס אחד לעדכון דרך המייל.");
    if (!emailRecipientRoles.length) throw new Error("יש לבחור לפחות סוג נמען אחד לשליחת מיילים.");

    await updateAttendanceSessionMessaging(sessionId, {
      emailSubject,
      personalMessage,
      emailResponseStatuses,
      emailRecipientRoles
    });
  } catch (error) {
    revalidatePath(`/attendance/${sessionId}`);
    redirect(`/attendance/${sessionId}?mailError=${encodeURIComponent(clean(error?.message) || "שליחת המיילים נכשלה")}`);
  }

  after(async () => {
    try {
      await sendAttendanceSessionEmails({
        sessionId,
        emailSubject,
        personalMessage,
        emailResponseStatuses,
        recipientRoles: emailRecipientRoles,
        targetStatuses,
        createdByUserId: user.clerk_user_id
      });
    } catch (error) {
      console.error("Attendance session email send failed", {
        sessionId,
        error: error instanceof Error ? error.message : String(error || "Unknown error")
      });
    } finally {
      revalidatePath(`/attendance/${sessionId}`);
    }
  });

  redirect(`/attendance/${sessionId}?mailQueued=1`);
}

export async function saveAttendanceSessionStudentsAction(formData) {
  await requireAttendanceUser();
  const sessionId = clean(formData.get("sessionId"));
  if (!sessionId) throw new Error("Missing attendance session id.");
  const manualStudentIds = cleanList(formData.getAll("manualStudentIds"));

  const roster = await updateAttendanceSessionManualStudents(sessionId, manualStudentIds);

  revalidatePath(`/attendance/${sessionId}`);
  redirect(`/attendance/${sessionId}?studentsSaved=1&studentsSavedCount=${roster?.students?.length || 0}`);
}

export async function setAttendanceSessionManualStudentAction(formData) {
  await requireAttendanceUser();
  const sessionId = clean(formData.get("sessionId"));
  const studentId = clean(formData.get("studentId"));
  const selected = clean(formData.get("selected")) === "1";
  if (!sessionId || !studentId) throw new Error("Missing attendance student selection.");

  await setAttendanceSessionManualStudent(sessionId, studentId, selected);
  revalidatePath(`/attendance/${sessionId}`);
  return { ok: true, studentId, selected };
}

export async function sendAttendanceSessionWhatsAppAction(formData) {
  const user = await requireAttendanceUser();
  const sessionId = clean(formData.get("sessionId"));
  const responseStatuses = cleanList(formData.getAll("whatsappResponseStatuses"));
  const targetStatuses = cleanList(formData.getAll("targetStatuses"));
  const recipientRoles = cleanList(formData.getAll("emailRecipientRoles"));
  const imageFile = formData.get("whatsappImage");
  const useGenericTemplate = clean(formData.get("useGenericWhatsAppTemplate")) === "1";
  if (!sessionId) throw new Error("Missing attendance session id.");
  if (responseStatuses.length !== 2) {
    redirect(`/attendance/${sessionId}?whatsappError=${encodeURIComponent("יש לבחור בדיוק שני סטטוסים לעדכון דרך WhatsApp")}`);
  }
  after(async () => {
    try {
      const imageId = imageFile && typeof imageFile.arrayBuffer === "function" && imageFile.size
        ? await uploadAttendanceWhatsAppImage(imageFile)
        : "";
      await sendAttendanceSessionWhatsApp({
        sessionId,
        personalMessage: clean(formData.get("personalMessage")),
        responseStatuses,
        targetStatuses,
        recipientRoles,
        imageId,
        useGenericTemplate,
        createdByUserId: user.clerk_user_id
      });
    } catch (error) {
      console.error("Attendance WhatsApp batch failed", { sessionId, error: clean(error?.message) });
    }
  });
  redirect(`/attendance/${sessionId}?whatsappQueued=1`);
}

export async function sendAttendanceSessionWhatsAppApprovedTemplateAction(formData) {
  const user = await requireAttendanceUser();
  const sessionId = clean(formData.get("sessionId"));
  const templateName = clean(formData.get("whatsappTemplateName"));
  const templateLanguage = clean(formData.get("whatsappTemplateLanguage")) || "he";
  const recipientRoles = cleanList(formData.getAll("whatsappRecipientRoles"));
  const targetStatuses = cleanList(formData.getAll("whatsappTargetStatuses"));
  const responseStatuses = cleanList(formData.getAll("whatsappResponseStatuses"));
  const templateValues = Object.fromEntries(
    Array.from({ length: 20 }, (_, index) => [String(index + 1), clean(formData.get(`whatsappTemplateValue_${index + 1}`))]).filter(([, value]) => value)
  );
  const imageFile = formData.get("whatsappTemplateImage");
  if (!sessionId) throw new Error("Missing attendance session id.");
  try {
    if (!templateName) throw new Error("יש לבחור תבנית WhatsApp מאושרת.");
    if (!recipientRoles.length) throw new Error("יש לבחור לפחות סוג נמען אחד לשליחת WhatsApp.");
    const templates = await listWhatsAppCoexistenceApprovedTemplates();
    const imageId = imageFile && typeof imageFile.arrayBuffer === "function" && imageFile.size
      ? await uploadAttendanceWhatsAppImage(imageFile)
      : "";
    const result = await sendAttendanceSessionWhatsAppApprovedTemplate({
      sessionId,
      templateName,
      templateLanguage,
      recipientRoles,
      targetStatuses,
      responseStatuses,
      templates,
      imageId,
      parameterOverrides: templateValues,
      createdByUserId: user.clerk_user_id
    });
    if (!result.sentMessages && result.failedMessages) {
      throw new Error("שליחת WhatsApp נכשלה לכל הנמענים. בדוק את התבנית, המספרים והחיבור.");
    }
  } catch (error) {
    revalidatePath(`/attendance/${sessionId}`);
    redirect(`/attendance/${sessionId}?whatsappTemplateError=${encodeURIComponent(clean(error?.message) || "שליחת WhatsApp נכשלה")}`);
  }
  revalidatePath(`/attendance/${sessionId}`);
  redirect(`/attendance/${sessionId}?whatsappTemplateSent=1`);
}
