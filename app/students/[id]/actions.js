"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { syncNeonStudentFromTwentyById } from "../../../lib/neon-students";
import { DELETE_CONFIRMATION_TEXT, softDeleteStudentById } from "../../../lib/deleted-students";
import { upsertStudentNote } from "../../../lib/notes";
import { canEditStudentCard, requireAuthenticatedUser } from "../../../lib/rbac";
import { toFormData } from "../../../lib/student-fields";
import { updateStudentById } from "../../../lib/twenty";

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
  const data = toFormData(raw, { preserveEmptyEnums: true });

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
  const confirmationText = clean(formData.get("confirmationText"));
  const confirmDelete = clean(formData.get("confirmDelete"));

  if (!user.is_team_member && !user.is_manager) {
    redirect("/unauthorized");
  }

  if (!studentId) {
    redirect("/?error=לא נבחר תלמיד למחיקה");
  }

  if (confirmDelete !== "1" || confirmationText !== DELETE_CONFIRMATION_TEXT) {
    redirect(`/students/${studentId}?error=${encodeURIComponent("כדי למחוק תלמיד צריך לסמן אישור ולהקליד בדיוק: אני מאשר")}`);
  }

  try {
    await softDeleteStudentById(studentId, user.clerk_user_id);
    revalidatePath("/");
    revalidatePath("/neon");
    revalidatePath("/admin/deleted-students");
  } catch (error) {
    const message = encodeURIComponent(error?.message || "מחיקת התלמיד נכשלה");
    redirect(`/students/${studentId}?error=${message}`);
  }

  redirect("/admin/deleted-students?deleted=1");
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
