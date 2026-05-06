"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { permanentlyDeleteSoftDeletedStudentById, restoreSoftDeletedStudentById } from "../../../lib/deleted-students";
import { requireAuthenticatedUser } from "../../../lib/rbac";

function clean(value) {
  return String(value || "").trim();
}

function ensureCanManage(user) {
  if (!user?.is_team_member && !user?.is_manager) {
    redirect("/unauthorized");
  }
}

export async function restoreDeletedStudentAction(formData) {
  const user = await requireAuthenticatedUser();
  ensureCanManage(user);

  const studentId = clean(formData.get("studentId"));
  if (!studentId) redirect("/admin/deleted-students?error=לא נבחר תלמיד לשחזור");

  try {
    await restoreSoftDeletedStudentById(studentId);
    revalidatePath("/");
    revalidatePath("/neon");
    revalidatePath("/admin/deleted-students");
    redirect("/admin/deleted-students?restored=1");
  } catch (error) {
    redirect(`/admin/deleted-students?error=${encodeURIComponent(error?.message || "שחזור התלמיד נכשל")}`);
  }
}

export async function purgeDeletedStudentNowAction(formData) {
  const user = await requireAuthenticatedUser();
  ensureCanManage(user);

  const studentId = clean(formData.get("studentId"));
  if (!studentId) redirect("/admin/deleted-students?error=לא נבחר תלמיד למחיקה סופית");

  try {
    await permanentlyDeleteSoftDeletedStudentById(studentId);
    revalidatePath("/");
    revalidatePath("/neon");
    revalidatePath("/admin/deleted-students");
    redirect("/admin/deleted-students?purged=1");
  } catch (error) {
    redirect(`/admin/deleted-students?error=${encodeURIComponent(error?.message || "מחיקה סופית נכשלה")}`);
  }
}
