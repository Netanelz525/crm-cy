"use server";

import { revalidatePath } from "next/cache";
import { approveUnknownUser, requireTeamUser, setOwnCardEditPermission } from "../../lib/rbac";

function clean(v) {
  return String(v || "").trim();
}

export async function approveUserAction(formData) {
  const approver = await requireTeamUser();
  const targetUserId = clean(formData.get("targetUserId"));
  const withEdit = clean(formData.get("withEdit")) === "1";
  if (!targetUserId) return;
  await approveUnknownUser(targetUserId, approver.clerk_user_id, withEdit);
  revalidatePath("/admin");
}

export async function setEditPermissionAction(formData) {
  await requireTeamUser();
  const targetUserId = clean(formData.get("targetUserId"));
  const enabled = clean(formData.get("enabled")) === "1";
  if (!targetUserId) return;
  await setOwnCardEditPermission(targetUserId, enabled);
  revalidatePath("/admin");
}

