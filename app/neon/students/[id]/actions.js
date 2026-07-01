"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { saveOpenAttendanceRecordForStudent } from "../../../../lib/attendance";
import { DELETE_CONFIRMATION_TEXT, softDeleteStudentById } from "../../../../lib/deleted-students";
import { assertStudentAccess, requireAuthenticatedUser } from "../../../../lib/rbac";
import { createStudentContactLog } from "../../../../lib/student-contact-logs";
import { createStudentDocument, getStudentDocumentById, updateStudentDocumentName } from "../../../../lib/student-documents";
import { toFormData } from "../../../../lib/student-fields";
import { updateNeonStudentViaTwenty } from "../../../../lib/neon-students";
import { addStudentTagToStudent, removeStudentTagFromStudent, replaceStudentTags } from "../../../../lib/student-tags";

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
  const data = toFormData(raw, { preserveEmptyEnums: true });

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

export async function deleteNeonStudentAction(formData) {
  const user = await requireAuthenticatedUser();
  const studentId = clean(formData.get("studentId"));
  const confirmationText = clean(formData.get("confirmationText"));
  const confirmDelete = clean(formData.get("confirmDelete"));

  if (!user.is_team_member && !user.is_manager) {
    redirect("/unauthorized");
  }

  if (!studentId) {
    redirect("/neon?error=לא נבחר תלמיד למחיקה");
  }

  if (confirmDelete !== "1" || confirmationText !== DELETE_CONFIRMATION_TEXT) {
    redirect(`/neon/students/${studentId}?error=${encodeURIComponent("כדי למחוק תלמיד צריך לסמן אישור ולהקליד בדיוק: אני מאשר")}`);
  }

  try {
    await softDeleteStudentById(studentId, user.clerk_user_id);
    revalidatePath("/");
    revalidatePath("/neon");
    revalidatePath("/admin/deleted-students");
  } catch (error) {
    const message = encodeURIComponent(error?.message || "מחיקת התלמיד נכשלה");
    redirect(`/neon/students/${studentId}?error=${message}`);
  }

  redirect("/admin/deleted-students?deleted=1");
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

export async function updateStudentDocumentNameAction(formData) {
  const user = await requireAuthenticatedUser();
  const studentId = clean(formData.get("studentId"));
  const documentId = clean(formData.get("documentId"));
  const displayName = clean(formData.get("displayName"));

  if (!assertStudentAccess(user, studentId)) {
    redirect("/unauthorized");
  }

  try {
    const doc = await getStudentDocumentById(documentId);
    if (!doc || doc.studentId !== studentId) {
      throw new Error("המסמך לא נמצא בכרטיס התלמיד.");
    }
    await updateStudentDocumentName({ id: documentId, displayName });
  } catch (error) {
    const message = encodeURIComponent(error?.message || "עדכון שם המסמך נכשל");
    redirect(`/neon/students/${studentId}?error=${message}`);
  }

  redirect(`/neon/students/${studentId}?documentRenamed=1`);
}

export async function updateStudentTagsAction(formData) {
  const user = await requireAuthenticatedUser();
  const studentId = clean(formData.get("studentId"));

  if (!user.is_team_member && !user.is_manager) {
    redirect("/unauthorized");
  }

  try {
    await replaceStudentTags({
      studentId,
      tagIds: formData.getAll("tagIds"),
      assignedByUserId: user.clerk_user_id
    });
    revalidatePath("/neon");
    revalidatePath(`/neon/students/${studentId}`);
  } catch (error) {
    const message = encodeURIComponent(error?.message || "עדכון התגיות נכשל");
    redirect(`/neon/students/${studentId}?error=${message}`);
  }

  redirect(`/neon/students/${studentId}?tagsUpdated=1`);
}

export async function removeStudentTagAction(formData) {
  const user = await requireAuthenticatedUser();
  const studentId = clean(formData.get("studentId"));

  if (!user.is_team_member && !user.is_manager) {
    redirect("/unauthorized");
  }

  try {
    await removeStudentTagFromStudent({
      studentId,
      tagId: formData.get("tagId")
    });
    revalidatePath("/neon");
    revalidatePath(`/neon/students/${studentId}`);
  } catch (error) {
    const message = encodeURIComponent(error?.message || "הסרת התווית נכשלה");
    redirect(`/neon/students/${studentId}?error=${message}`);
  }

  redirect(`/neon/students/${studentId}?tagsUpdated=1`);
}

export async function addStudentTagAction(formData) {
  const user = await requireAuthenticatedUser();
  const studentId = clean(formData.get("studentId"));

  if (!user.is_team_member && !user.is_manager) {
    redirect("/unauthorized");
  }

  try {
    await addStudentTagToStudent({
      studentId,
      tagId: formData.get("tagId"),
      tagName: formData.get("newTagName"),
      assignedByUserId: user.clerk_user_id,
      createdByUserId: user.clerk_user_id
    });
    revalidatePath("/neon");
    revalidatePath(`/neon/students/${studentId}`);
  } catch (error) {
    const message = encodeURIComponent(error?.message || "שמירת התווית נכשלה");
    redirect(`/neon/students/${studentId}?error=${message}`);
  }

  redirect(`/neon/students/${studentId}?tagsUpdated=1`);
}

export async function addStudentContactAction(formData) {
  const user = await requireAuthenticatedUser();
  const studentId = clean(formData.get("studentId"));

  if (!user.is_team_member && !user.is_manager) {
    redirect("/unauthorized");
  }

  try {
    await createStudentContactLog({
      studentId,
      contactDate: formData.get("contactDate"),
      noteText: formData.get("noteText"),
      createdByUserId: user.clerk_user_id
    });
    revalidatePath("/neon");
    revalidatePath(`/neon/students/${studentId}`);
  } catch (error) {
    const message = encodeURIComponent(error?.message || "שמירת יצירת הקשר נכשלה");
    redirect(`/neon/students/${studentId}?error=${message}`);
  }

  redirect(`/neon/students/${studentId}?contactSaved=1`);
}

export async function updateStudentOpenAttendanceAction(formData) {
  const user = await requireAuthenticatedUser();
  const studentId = clean(formData.get("studentId"));
  const sessionId = clean(formData.get("sessionId"));

  if (!assertStudentAccess(user, studentId)) {
    redirect("/unauthorized");
  }

  try {
    await saveOpenAttendanceRecordForStudent({
      sessionId,
      studentId,
      status: formData.get("status"),
      noteText: formData.get("noteText"),
      markedByUserId: user.clerk_user_id
    });
    revalidatePath("/attendance");
    revalidatePath(`/attendance/${sessionId}`);
    revalidatePath(`/neon/students/${studentId}`);
  } catch (error) {
    const message = encodeURIComponent(error?.message || "עדכון הנוכחות נכשל");
    redirect(`/neon/students/${studentId}?error=${message}`);
  }

  redirect(`/neon/students/${studentId}?attendanceUpdated=1`);
}
