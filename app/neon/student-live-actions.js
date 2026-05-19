"use server";

import { revalidatePath } from "next/cache";
import { createStudentContactLog } from "../../lib/student-contact-logs";
import { createStudentEvent, deleteStudentEvent, updateStudentEvent } from "../../lib/student-events";
import { requireAuthenticatedUser } from "../../lib/rbac";
import { normalizeStudentInput } from "../../lib/student-fields";
import { updateNeonStudentViaTwenty } from "../../lib/neon-students";
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

export async function addStudentEventLiveAction({ studentId, eventType, customEventLabel, noteText, hebrewDay, hebrewMonthCode }) {
  const user = await requireAuthenticatedUser();

  if (!user.is_team_member && !user.is_manager && clean(user.linked_student_id) !== clean(studentId)) {
    return fail("אין הרשאה לעדכן אירועים.");
  }

  try {
    const created = await createStudentEvent({
      studentId,
      eventType,
      customEventLabel,
      noteText,
      hebrewDay,
      hebrewMonthCode,
      createdByUserId: user.clerk_user_id
    });
    revalidatePath("/neon");
    revalidatePath(`/neon/students/${clean(studentId)}`);
    return ok({
      event: {
        ...created,
        createdByDisplayName: clean(created?.createdByDisplayName) || clean(user.display_name) || clean(user.email),
        createdByEmail: clean(created?.createdByEmail) || clean(user.email)
      }
    });
  } catch (error) {
    return fail(error?.message || "שמירת האירוע נכשלה.");
  }
}

export async function updateStudentEventLiveAction({ id, studentId, eventType, customEventLabel, noteText, hebrewDay, hebrewMonthCode }) {
  const user = await requireAuthenticatedUser();

  if (!user.is_team_member && !user.is_manager && clean(user.linked_student_id) !== clean(studentId)) {
    return fail("אין הרשאה לעדכן אירועים.");
  }

  try {
    const updated = await updateStudentEvent({
      id,
      studentId,
      eventType,
      customEventLabel,
      noteText,
      hebrewDay,
      hebrewMonthCode
    });
    revalidatePath("/neon");
    revalidatePath(`/neon/students/${clean(studentId)}`);
    return ok({
      event: {
        ...updated,
        createdByDisplayName: clean(updated?.createdByDisplayName) || clean(user.display_name) || clean(user.email),
        createdByEmail: clean(updated?.createdByEmail) || clean(user.email)
      }
    });
  } catch (error) {
    return fail(error?.message || "עדכון האירוע נכשל.");
  }
}

export async function deleteStudentEventLiveAction({ id, studentId }) {
  const user = await requireAuthenticatedUser();

  if (!user.is_team_member && !user.is_manager && clean(user.linked_student_id) !== clean(studentId)) {
    return fail("אין הרשאה למחוק אירועים.");
  }

  try {
    await deleteStudentEvent({ id, studentId });
    revalidatePath("/neon");
    revalidatePath(`/neon/students/${clean(studentId)}`);
    return ok({ id: clean(id) });
  } catch (error) {
    return fail(error?.message || "מחיקת האירוע נכשלה.");
  }
}

export async function bulkUpdateStudentsLiveAction({ studentIds = [], fields = {}, bulkTagId = "", bulkNewTagName = "" }) {
  const user = await requireAuthenticatedUser();
  if (!user.is_team_member && !user.is_manager) {
    return fail("אין הרשאה לעדכון מרוכז.");
  }

  const normalizedStudentIds = Array.isArray(studentIds) ? studentIds.map(clean).filter(Boolean) : [];
  if (!normalizedStudentIds.length) {
    return fail("לא נבחרו תלמידים לעדכון.");
  }

  const data = normalizeStudentInput(fields || {}, { preserveEmptyEnums: true });
  const hasFieldUpdate = Object.keys(data).length > 0;
  const hasBulkTagUpdate = clean(bulkTagId) || clean(bulkNewTagName);

  if (!hasFieldUpdate && !hasBulkTagUpdate) {
    return fail("לא נבחרו שדות או תווית לעדכון.");
  }

  let updated = 0;
  let failed = 0;
  const errors = [];
  let createdTag = null;

  for (const studentId of normalizedStudentIds) {
    try {
      if (hasFieldUpdate) {
        await updateNeonStudentViaTwenty(studentId, data);
      }
      if (hasBulkTagUpdate) {
        const tag = await addStudentTagToStudent({
          studentId,
          tagId: bulkTagId,
          tagName: bulkNewTagName,
          assignedByUserId: user.clerk_user_id,
          createdByUserId: user.clerk_user_id
        });
        if (tag?.id) createdTag = tag;
      }
      updated += 1;
    } catch (error) {
      failed += 1;
      errors.push(`${studentId}: ${error?.message || "העדכון נכשל"}`);
    }
  }

  revalidatePath("/neon");
  revalidatePath("/neon/students");

  return ok({
    updated,
    failed,
    errors,
    fields: data,
    tag: createdTag,
    studentIds: normalizedStudentIds
  });
}
