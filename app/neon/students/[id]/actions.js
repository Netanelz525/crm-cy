"use server";

import { redirect } from "next/navigation";
import { canEditStudentCard, requireAuthenticatedUser } from "../../../../lib/rbac";
import { toFormData } from "../../../../lib/student-fields";
import { updateNeonStudentViaTwenty } from "../../../../lib/neon-students";

function clean(v) {
  return String(v || "").trim();
}

export async function updateNeonStudentAction(formData) {
  const user = await requireAuthenticatedUser();
  const studentId = clean(formData.get("studentId"));

  if (!canEditStudentCard(user, studentId)) {
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
