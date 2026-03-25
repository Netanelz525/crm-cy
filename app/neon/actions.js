"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { importStudentsFromExcelFile } from "../../lib/excel-student-import";
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
