"use server";

import { redirect } from "next/navigation";
import { removeNeonStudentById, syncNeonStudentFromTwentyById } from "../../../lib/neon-students";
import { upsertStudentNote } from "../../../lib/notes";
import { canEditStudentCard, requireAuthenticatedUser } from "../../../lib/rbac";
import { toFormData } from "../../../lib/student-fields";
import { deleteStudentById, updateStudentById } from "../../../lib/twenty";

function clean(v) {
  return String(v || "").trim();
}

export async function updateStudentAction(formData) {
  const user = await requireAuthenticatedUser();
  const studentId = clean(formData.get("studentId"));

  if (!canEditStudentCard(user, studentId)) {
    redirect("/unauthorized");
  }

  const raw = Object.fromEntries(formData.entries());
  const data = toFormData(raw);

  if (!Object.keys(data).length) {
    redirect(`/students/${studentId}?edit=1&error=לא הוזנו נתונים לשמירה`);
  }

  await updateStudentById(studentId, data);
  await syncNeonStudentFromTwentyById(studentId);
  redirect(`/students/${studentId}?updated=1`);
}

export async function deleteStudentAction(formData) {
  const user = await requireAuthenticatedUser();
  const studentId = clean(formData.get("studentId"));

  if (!user.is_team_member && !user.is_manager) {
    redirect("/unauthorized");
  }

  if (!studentId) {
    redirect("/?error=לא נבחר תלמיד למחיקה");
  }

  try {
    await deleteStudentById(studentId);
    await removeNeonStudentById(studentId);
  } catch (error) {
    const message = encodeURIComponent(error?.message || "מחיקת התלמיד נכשלה");
    redirect(`/students/${studentId}?error=${message}`);
  }

  redirect("/?deleted=1");
}

export async function updateNoteAction(formData) {
  const user = await requireAuthenticatedUser();
  const studentId = clean(formData.get("studentId"));
  if (!canEditStudentCard(user, studentId)) {
    redirect("/unauthorized");
  }
  await upsertStudentNote({
    studentId,
    noteText: clean(formData.get("noteText")),
    noteStatus: clean(formData.get("noteStatus")),
    directDebitActive: clean(formData.get("directDebitActive")),
    signedByUserId: user.clerk_user_id
  });
  redirect(`/students/${studentId}?internalUpdated=1`);
}
