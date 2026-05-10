"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAttendanceSession, deleteAttendanceSession, saveAttendanceRecord } from "../../lib/attendance";
import { requireAttendanceUser } from "../../lib/rbac";

function clean(value) {
  return String(value || "").trim();
}

export async function createAttendanceSessionAction(formData) {
  const user = await requireAttendanceUser();
  const institution = clean(formData.get("institution"));
  const sessionType = clean(formData.get("sessionType"));
  const sessionDate = clean(formData.get("sessionDate"));
  const sourceNote = clean(formData.get("sourceNote"));

  const session = await createAttendanceSession({
    id: crypto.randomUUID(),
    institution,
    sessionType,
    sessionDate,
    sourceNote,
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

  revalidatePath("/attendance");
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
