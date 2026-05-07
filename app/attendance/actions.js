"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAttendanceSession, saveAttendanceRecords } from "../../lib/attendance";
import { requireTeamUser } from "../../lib/rbac";

function clean(value) {
  return String(value || "").trim();
}

export async function createAttendanceSessionAction(formData) {
  const user = await requireTeamUser();
  const institution = clean(formData.get("institution"));
  const title = clean(formData.get("title"));
  const sessionDate = clean(formData.get("sessionDate"));
  const sourceNote = clean(formData.get("sourceNote"));

  const session = await createAttendanceSession({
    id: crypto.randomUUID(),
    institution,
    title,
    sessionDate,
    sourceNote,
    createdByUserId: user.clerk_user_id
  });

  revalidatePath("/attendance");
  redirect(`/attendance?sessionId=${session.id}&created=1`);
}

export async function saveAttendanceRecordsAction(formData) {
  const user = await requireTeamUser();
  const sessionId = clean(formData.get("sessionId"));
  const studentIds = formData.getAll("studentId").map(clean).filter(Boolean);
  const records = studentIds.map((studentId) => ({
    studentId,
    studentName: clean(formData.get(`studentName:${studentId}`)),
    studentClass: clean(formData.get(`studentClass:${studentId}`)),
    status: clean(formData.get(`status:${studentId}`)),
    noteText: clean(formData.get(`note:${studentId}`))
  }));

  await saveAttendanceRecords({
    sessionId,
    records,
    markedByUserId: user.clerk_user_id
  });

  revalidatePath("/attendance");
  redirect(`/attendance?sessionId=${sessionId}&saved=1`);
}
