"use server";

import { redirect } from "next/navigation";
import { assertStudentAccess, requireAuthenticatedUser } from "../../../../lib/rbac";
import { createStudentDocument } from "../../../../lib/student-documents";
import { toFormData } from "../../../../lib/student-fields";
import { updateNeonStudentViaTwenty } from "../../../../lib/neon-students";

function clean(v) {
  return String(v || "").trim();
}

export async function updateNeonStudentAction(formData) {
  const user = await requireAuthenticatedUser();
  const studentId = clean(formData.get("studentId"));

  if (!user.is_team_member && !user.is_manager) {
    redirect("/unauthorized");
  }

  const raw = Object.fromEntries(formData.entries());
  const data = toFormData(raw);

  if (!Object.keys(data).length) {
    redirect(`/neon/students/${studentId}?edit=1&error=לא הוזנו נתונים לשמירה`);
  }

  try {
    await updateNeonStudentViaTwenty(studentId, data);
  } catch (error) {
    const message = encodeURIComponent(error?.message || "שמירת התלמיד נכשלה");
    redirect(`/neon/students/${studentId}?edit=1&error=${message}`);
  }

  redirect(`/neon/students/${studentId}?updated=1`);
}

export async function uploadStudentDocumentAction(formData) {
  const user = await requireAuthenticatedUser();
  const studentId = clean(formData.get("studentId"));
  const file = formData.get("file");
  const displayName = clean(formData.get("displayName"));
  const noteText = clean(formData.get("noteText"));
  const documentKind = clean(formData.get("documentKind")) || "general";

  if (!assertStudentAccess(user, studentId)) {
    redirect("/unauthorized");
  }

  try {
    await createStudentDocument({
      studentId,
      uploadedByUserId: user.clerk_user_id,
      file,
      documentKind,
      displayName,
      noteText
    });
  } catch (error) {
    const message = encodeURIComponent(error?.message || "העלאת המסמך נכשלה");
    redirect(`/neon/students/${studentId}?error=${message}`);
  }

  redirect(`/neon/students/${studentId}?documentUploaded=1`);
}
