"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAttendanceSession, deleteAttendanceSession, saveAttendanceRecord } from "../../lib/attendance";
import { requireAttendanceUser } from "../../lib/rbac";

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
