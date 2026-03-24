"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
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
