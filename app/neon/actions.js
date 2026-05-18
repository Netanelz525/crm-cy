"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { parseExcelFile } from "../../lib/excel-student-import";
import { configureImportSession, createImportSession } from "../../lib/import-sessions";
import { DELETE_CONFIRMATION_TEXT, softDeleteStudentById } from "../../lib/deleted-students";
import { normalizeStudentInput } from "../../lib/student-fields";
import { sanitizeQueryString } from "../../lib/student-view";
import { requireAuthenticatedUser } from "../../lib/rbac";
import { syncStudentsToNeon } from "../../lib/neon-students";
import { deleteNeonPreferencesForUser, saveNeonPreferencesForUser } from "../../lib/neon-preferences";
import { createStudentTag, deleteStudentTag } from "../../lib/student-tags";

function isRedirectError(error) {
  return Boolean(error?.digest && String(error.digest).startsWith("NEXT_REDIRECT"));
}

export async function syncNeonStudentsAction() {
  const user = await requireAuthenticatedUser();
  if (!user.is_team_member && !user.is_manager) {
    redirect("/unauthorized");
  }

  const result = await syncStudentsToNeon();
  revalidatePath("/neon");
  revalidatePath("/neon/students");
  redirect(`/neon?synced=1&count=${result.syncedCount}`);
}

export async function prepareNeonStudentsImportAction(formData) {
  const user = await requireAuthenticatedUser();
  if (!user.is_team_member && !user.is_manager) {
    redirect("/unauthorized");
  }

  const file = formData.get("file");
  if (!file || typeof file.arrayBuffer !== "function") {
    redirect("/neon?importError=לא נבחר קובץ");
  }

  try {
    const parsed = await parseExcelFile(file);
    const sessionId = await createImportSession({
      createdByUserId: user.clerk_user_id,
      fileName: parsed.fileName,
      headers: parsed.headers,
      rows: parsed.rows
    });
    redirect(`/neon/import/${sessionId}`);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    const message = encodeURIComponent(error?.message || "ייבוא האקסל נכשל");
    redirect(`/neon?importError=${message}`);
  }
}

function clean(value) {
  return String(value || "").trim();
}

export async function saveNeonPreferencesAction(formData) {
  const user = await requireAuthenticatedUser();
  if (!user.is_team_member && !user.is_manager) {
    redirect("/unauthorized");
  }

  const rawQueryString = clean(formData.get("queryString"));
  const sanitizedQueryString = sanitizeQueryString(rawQueryString);
  const nextPath = clean(formData.get("returnPath")) || "/neon";

  try {
    await saveNeonPreferencesForUser({
      ownerUserId: user.clerk_user_id,
      queryString: sanitizedQueryString
    });

    revalidatePath("/neon");
    redirect(`${nextPath}${nextPath.includes("?") ? "&" : "?"}prefsSaved=1`);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    const message = encodeURIComponent(error?.message || "שמירת ההעדפות נכשלה");
    redirect(`${nextPath}${nextPath.includes("?") ? "&" : "?"}prefsError=${message}`);
  }
}

export async function resetNeonPreferencesAction() {
  const user = await requireAuthenticatedUser();
  if (!user.is_team_member && !user.is_manager) {
    redirect("/unauthorized");
  }

  try {
    await deleteNeonPreferencesForUser(user.clerk_user_id);
    revalidatePath("/neon");
    redirect("/neon?prefsReset=1");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    const message = encodeURIComponent(error?.message || "איפוס ההעדפות נכשל");
    redirect(`/neon?prefsError=${message}`);
  }
}

export async function createStudentTagAction(formData) {
  const user = await requireAuthenticatedUser();
  if (!user.is_team_member && !user.is_manager) {
    redirect("/unauthorized");
  }

  const returnTo = clean(formData.get("returnTo")) || "/neon";

  try {
    await createStudentTag({
      name: formData.get("tagName"),
      createdByUserId: user.clerk_user_id
    });
    revalidatePath("/neon");
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}tagCreated=1`);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    const message = encodeURIComponent(error?.message || "יצירת התגית נכשלה");
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}tagsError=${message}`);
  }
}

export async function deleteStudentTagAction(formData) {
  const user = await requireAuthenticatedUser();
  if (!user.is_team_member && !user.is_manager) {
    redirect("/unauthorized");
  }

  const tagId = clean(formData.get("tagId"));
  const returnTo = clean(formData.get("returnTo")) || "/neon";

  try {
    await deleteStudentTag(tagId);
    revalidatePath("/neon");
    revalidatePath("/neon/students");
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}tagDeleted=1`);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    const message = encodeURIComponent(error?.message || "מחיקת התגית נכשלה");
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}tagsError=${message}`);
  }
}

export async function bulkUpdateNeonStudentsAction(formData) {
  const user = await requireAuthenticatedUser();
  if (!user.is_team_member && !user.is_manager) {
    redirect("/unauthorized");
  }

  const studentIds = formData.getAll("studentIds").map(clean).filter(Boolean);
  const returnTo = clean(formData.get("returnTo")) || "/neon";
  if (!studentIds.length) {
    redirect("/neon?bulkError=לא נבחרו תלמידים לעדכון");
  }

  const raw = {};
  const allowedFields = [
    "currentInstitution",
    "registration",
    "class",
    "famliystatus",
    "healthInsurance",
    "childrenCount",
    "note"
  ];

  for (const field of allowedFields) {
    if (clean(formData.get(`apply_${field}`)) !== "1") continue;
    raw[field] = formData.get(field);
  }

  const data = normalizeStudentInput(raw, { preserveEmptyEnums: true });
  if (!Object.keys(data).length) {
    redirect("/neon?bulkError=לא נבחרו שדות לעדכון");
  }

  let updated = 0;
  let failed = 0;
  const errors = [];

  for (const studentId of studentIds) {
    try {
      const { updateNeonStudentViaTwenty } = await import("../../lib/neon-students");
      await updateNeonStudentViaTwenty(studentId, data);
      updated += 1;
    } catch (error) {
      failed += 1;
      errors.push(`${studentId}: ${error?.message || "העדכון נכשל"}`);
    }
  }

  revalidatePath("/neon");
  revalidatePath("/neon/students");

  const params = new URLSearchParams({
    bulkUpdated: "1",
    updated: String(updated),
    failed: String(failed)
  });
  if (errors.length) {
    params.set("bulkMessage", errors.slice(0, 5).join(" | "));
  }
  redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}${params.toString()}`);
}

export async function bulkDeleteNeonStudentsAction(formData) {
  const user = await requireAuthenticatedUser();
  if (!user.is_team_member && !user.is_manager) {
    redirect("/unauthorized");
  }

  const studentIds = formData.getAll("studentIds").map(clean).filter(Boolean);
  const confirmationText = clean(formData.get("confirmationText"));
  const confirmDelete = clean(formData.get("confirmDelete"));

  if (!studentIds.length) {
    redirect("/neon?bulkError=לא נבחרו תלמידים למחיקה");
  }

  if (confirmDelete !== "1" || confirmationText !== DELETE_CONFIRMATION_TEXT) {
    redirect("/neon?bulkError=כדי למחוק תלמידים צריך לסמן אישור ולהקליד בדיוק: אני מאשר");
  }

  let deleted = 0;
  let failed = 0;
  const errors = [];

  for (const studentId of studentIds) {
    try {
      await softDeleteStudentById(studentId, user.clerk_user_id);
      deleted += 1;
    } catch (error) {
      failed += 1;
      errors.push(`${studentId}: ${error?.message || "המחיקה נכשלה"}`);
    }
  }

  revalidatePath("/");
  revalidatePath("/neon");
  revalidatePath("/neon/students");
  revalidatePath("/admin/deleted-students");

  const params = new URLSearchParams({
    bulkDeleted: "1",
    deleted: String(deleted),
    failed: String(failed)
  });
  if (errors.length) {
    params.set("bulkMessage", errors.slice(0, 5).join(" | "));
  }
  redirect(`/admin/deleted-students?${params.toString()}`);
}

export async function applyNeonStudentsImportAction(formData) {
  const user = await requireAuthenticatedUser();
  if (!user.is_team_member && !user.is_manager) {
    redirect("/unauthorized");
  }

  const sessionId = clean(formData.get("sessionId"));
  if (!sessionId) {
    redirect("/neon?importError=לא נמצא session לייבוא");
  }

  const matchMapping = {
    id: clean(formData.get("match_id")),
    tznum: clean(formData.get("match_tznum")),
    email: clean(formData.get("match_email"))
  };

  const fieldMapping = {};
  for (const [key, value] of formData.entries()) {
    if (!String(key).startsWith("map_")) continue;
    const fieldKey = String(key).slice(4);
    const header = clean(value);
    if (header) fieldMapping[fieldKey] = header;
  }

  try {
    await configureImportSession(sessionId, { matchMapping, fieldMapping });
    redirect(`/neon/import/${sessionId}/progress`);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    const message = encodeURIComponent(error?.message || "שמירת הגדרות הייבוא נכשלה");
    redirect(`/neon/import/${sessionId}?error=${message}`);
  }
}
