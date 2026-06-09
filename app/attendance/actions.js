"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createAttendanceSession,
  deleteAttendanceSession,
  parseAttendanceCustomStatusesText,
  saveAttendanceRecord,
  syncAttendanceSessionStudents,
  updateAttendanceSessionCustomStatuses,
  updateAttendanceSessionMessaging
} from "../../lib/attendance";
import { sendAttendanceSessionEmails } from "../../lib/attendance-email";
import { requireAttendanceUser, requireEmailSender } from "../../lib/rbac";

function clean(value) {
  return String(value || "").trim();
}

function cleanList(values) {
  return (Array.isArray(values) ? values : [values]).map(clean).filter(Boolean);
}

export async function createAttendanceSessionAction(formData) {
  const user = await requireAttendanceUser();
  const canUseSessionAudienceFilters = user.is_manager || user.is_super_admin;
  const institution = clean(formData.get("institution"));
  const sessionType = clean(formData.get("sessionType"));
  const sessionDate = clean(formData.get("sessionDate"));
  const sourceNote = clean(formData.get("sourceNote"));
  const institutionFilter = canUseSessionAudienceFilters ? cleanList(formData.getAll("institutionFilter")) : [];
  const classFilter = canUseSessionAudienceFilters ? cleanList(formData.getAll("classFilter")) : [];
  const registrationFilter = canUseSessionAudienceFilters ? cleanList(formData.getAll("registrationFilter")) : [];
  const familyStatusFilter = canUseSessionAudienceFilters ? cleanList(formData.getAll("familyStatusFilter")) : [];

  const session = await createAttendanceSession({
    id: crypto.randomUUID(),
    institution,
    sessionType,
    sessionDate,
    sourceNote,
    institutionFilter,
    classFilter,
    registrationFilter,
    familyStatusFilter,
    createdByUserId: user.clerk_user_id
  });

  revalidatePath("/attendance");
  revalidatePath(`/attendance/${session.id}`);
  redirect(`/attendance/${session.id}?created=1`);
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
  const customStatuses = parseAttendanceCustomStatusesText(formData.get("customStatusesText"));
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

export async function sendAttendanceSessionEmailsAction(formData) {
  const user = await requireEmailSender();
  const sessionId = clean(formData.get("sessionId"));
  const emailSubject = clean(formData.get("emailSubject"));
  const personalMessage = clean(formData.get("personalMessage"));
  const emailResponseStatuses = cleanList(formData.getAll("emailResponseStatuses"));
  const emailRecipientRoles = cleanList(formData.getAll("emailRecipientRoles"));
  const targetStatuses = cleanList(formData.getAll("targetStatuses"));
  if (!sessionId) throw new Error("Missing attendance session id.");

  await updateAttendanceSessionMessaging(sessionId, {
    emailSubject,
    personalMessage,
    emailResponseStatuses,
    emailRecipientRoles
  });

  const result = await sendAttendanceSessionEmails({
    sessionId,
    emailSubject,
    personalMessage,
    emailResponseStatuses,
    recipientRoles: emailRecipientRoles,
    targetStatuses,
    createdByUserId: user.clerk_user_id
  });

  revalidatePath(`/attendance/${sessionId}`);
  redirect(`/attendance/${sessionId}?mailSent=1&sentEmails=${encodeURIComponent(String(result.sentEmails || 0))}`);
}
