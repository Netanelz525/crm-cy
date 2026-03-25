"use server";

import { revalidatePath } from "next/cache";
import { createApiToken, revokeApiToken } from "../../lib/api-tokens";
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

export async function createApiTokenAction(_prevState, formData) {
  const user = await requireTeamUser();
  const label = clean(formData.get("label"));
  const resource = clean(formData.get("resource")) || "students";
  const access = clean(formData.get("access")) || "read";
  const scopesByAccess = {
    read: [`${resource}:read`],
    write: [`${resource}:read`, `${resource}:write`],
    delete: [`${resource}:read`, `${resource}:delete`],
    full: [`${resource}:read`, `${resource}:write`, `${resource}:delete`]
  };

  try {
    const result = await createApiToken({
      label,
      scopes: scopesByAccess[access] || [`${resource}:read`],
      createdByUserId: user.clerk_user_id
    });
    revalidatePath("/admin");
    return {
      ok: true,
      token: result.rawToken,
      label: result.label,
      scopes: result.scopes,
      message: "הטוקן נוצר. שמור אותו עכשיו, הוא לא יוצג שוב."
    };
  } catch (error) {
    return {
      ok: false,
      token: "",
      label,
      scopes: [],
      message: error?.message || "יצירת הטוקן נכשלה"
    };
  }
}

export async function revokeApiTokenAction(formData) {
  await requireTeamUser();
  const tokenId = clean(formData.get("tokenId"));
  if (!tokenId) return;
  await revokeApiToken(tokenId);
  revalidatePath("/admin");
}
