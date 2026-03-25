"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { importStudentsFromExcelFile } from "../../lib/excel-student-import";
import { normalizeStudentInput } from "../../lib/student-fields";
import { requireAuthenticatedUser } from "../../lib/rbac";
import { syncStudentsToNeon } from "../../lib/neon-students";

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

export async function importNeonStudentsFromExcelAction(formData) {
  const user = await requireAuthenticatedUser();
  if (!user.is_team_member && !user.is_manager) {
    redirect("/unauthorized");
  }

  const file = formData.get("file");
  if (!file || typeof file.arrayBuffer !== "function") {
    redirect("/neon?importError=לא נבחר קובץ");
  }

  try {
    const result = await importStudentsFromExcelFile(file);
    revalidatePath("/neon");
    revalidatePath("/neon/students");
    const params = new URLSearchParams({
      imported: "1",
      updated: String(result.updated || 0),
      skipped: String(result.skipped || 0),
      failed: String(result.failed || 0)
    });
    if (result.errors?.length) {
      params.set("importMessage", result.errors.slice(0, 5).join(" | "));
    }
    redirect(`/neon?${params.toString()}`);
  } catch (error) {
    const message = encodeURIComponent(error?.message || "ייבוא האקסל נכשל");
    redirect(`/neon?importError=${message}`);
  }
}

function clean(value) {
  return String(value || "").trim();
}

export async function bulkUpdateNeonStudentsAction(formData) {
  const user = await requireAuthenticatedUser();
  if (!user.is_team_member && !user.is_manager) {
    redirect("/unauthorized");
  }

  const studentIds = formData.getAll("studentIds").map(clean).filter(Boolean);
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

  const data = normalizeStudentInput(raw);
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
  redirect(`/neon?${params.toString()}`);
}
