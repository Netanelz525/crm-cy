"use server";

import { revalidatePath } from "next/cache";
import { createStudentContactLog } from "../../lib/student-contact-logs";
import { requireAuthenticatedUser } from "../../lib/rbac";
import { addStudentTagToStudent, removeStudentTagFromStudent } from "../../lib/student-tags";

function clean(value) {
  return String(value || "").trim();
}

function ok(data = {}) {
  return { ok: true, ...data };
}

function fail(message) {
  return { ok: false, error: clean(message) || "הפעולה נכשלה." };
}

export async function addStudentTagLiveAction({ studentId, tagId, newTagName }) {
  const user = await requireAuthenticatedUser();
  if (!user.is_team_member && !user.is_manager) {
    return fail("אין הרשאה לעדכן תגיות.");
  }

  try {
    const tag = await addStudentTagToStudent({
      studentId,
      tagId,
      tagName: newTagName,
      assignedByUserId: user.clerk_user_id,
      createdByUserId: user.clerk_user_id
    });
    revalidatePath("/neon");
    revalidatePath(`/neon/students/${clean(studentId)}`);
    return ok({ tag });
  } catch (error) {
    return fail(error?.message || "הוספת התווית נכשלה.");
  }
}

export async function removeStudentTagLiveAction({ studentId, tagId }) {
  const user = await requireAuthenticatedUser();
  if (!user.is_team_member && !user.is_manager) {
    return fail("אין הרשאה להסיר תגיות.");
  }

  try {
    await removeStudentTagFromStudent({ studentId, tagId });
    revalidatePath("/neon");
    revalidatePath(`/neon/students/${clean(studentId)}`);
    return ok({ tagId: clean(tagId) });
  } catch (error) {
    return fail(error?.message || "הסרת התווית נכשלה.");
  }
}

export async function addStudentContactLiveAction({ studentId, contactDate, noteText }) {
  const user = await requireAuthenticatedUser();

  if (!user.is_team_member && !user.is_manager && clean(user.linked_student_id) !== clean(studentId)) {
    return fail("אין הרשאה לעדכן יצירת קשר.");
  }

  try {
    const created = await createStudentContactLog({
      studentId,
      contactDate,
      noteText,
      createdByUserId: user.clerk_user_id
    });
    revalidatePath("/neon");
    revalidatePath(`/neon/students/${clean(studentId)}`);
    return ok({
      contact: {
        ...created,
        createdByDisplayName: clean(created?.createdByDisplayName) || clean(user.display_name) || clean(user.email),
        createdByEmail: clean(created?.createdByEmail) || clean(user.email)
      }
    });
  } catch (error) {
    return fail(error?.message || "שמירת יצירת הקשר נכשלה.");
  }
}
