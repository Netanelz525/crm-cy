"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createApiToken, revokeApiToken } from "../../lib/api-tokens";
import { sendResendEmail } from "../../lib/resend";
import {
  approveUnknownUser,
  deleteAppUser,
  getAppUserByClerkUserId,
  requireSuperAdmin,
  requireTeamUser,
  setAppUserRole,
  setOwnCardEditPermission,
  setUserAgentChannelPreferences
} from "../../lib/rbac";
import {
  buildTelegramDeepLink,
  createTelegramLinkCode,
  unlinkTelegramByClerkUserId
} from "../../lib/telegram";
import {
  buildWhatsAppDeepLink,
  createWhatsAppLinkCode,
  unlinkWhatsAppByClerkUserId
} from "../../lib/whatsapp";

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
    full: [`${resource}:read`, `${resource}:write`, `${resource}:delete`],
    backup: ["backup:read"]
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

export async function sendResendTestEmailAction(formData) {
  const user = await requireTeamUser();
  const to = clean(formData.get("to")) || clean(user.email);
  const subject = clean(formData.get("subject")) || "בדיקת מייל מה-CRM";
  const message = clean(formData.get("message")) || "זהו מייל בדיקה ממערכת ה-CRM.";

  try {
    await sendResendEmail({
      to,
      subject,
      text: message,
      html: `<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.6">${message.replace(/\n/g, "<br />")}</div>`,
      replyTo: user.email
    });
    redirect("/admin?emailSent=1");
  } catch (error) {
    const messageText = encodeURIComponent(error?.message || "שליחת מייל הבדיקה נכשלה");
    redirect(`/admin?emailError=${messageText}`);
  }
}

export async function updateUserRoleAction(formData) {
  const currentUser = await requireSuperAdmin();
  const targetUserId = clean(formData.get("targetUserId"));
  const role = clean(formData.get("role"));
  if (!targetUserId || targetUserId === currentUser.clerk_user_id) {
    if (targetUserId === currentUser.clerk_user_id) throw new Error("אי אפשר לשנות לעצמך את תפקיד הסופר אדמין.");
    return;
  }
  await setAppUserRole(targetUserId, role);
  revalidatePath("/admin");
}

export async function updateUserAgentPreferencesAction(formData) {
  await requireSuperAdmin();
  const targetUserId = clean(formData.get("targetUserId"));
  if (!targetUserId) return;
  await setUserAgentChannelPreferences(targetUserId, {
    preferredAgentChannel: clean(formData.get("preferredAgentChannel")),
    telegramEnabled: clean(formData.get("agentTelegramEnabled")) === "1",
    whatsappEnabled: clean(formData.get("agentWhatsAppEnabled")) === "1"
  });
  revalidatePath("/admin");
}

export async function deleteUserAction(formData) {
  const currentUser = await requireSuperAdmin();
  const targetUserId = clean(formData.get("targetUserId"));
  if (!targetUserId || targetUserId === currentUser.clerk_user_id) {
    if (targetUserId === currentUser.clerk_user_id) throw new Error("אי אפשר למחוק את המשתמש הנוכחי.");
    return;
  }
  await deleteAppUser(targetUserId);
  revalidatePath("/admin");
}

export async function generateUserTelegramLinkCodeAction(targetUserId) {
  await requireSuperAdmin();
  const user = await getAppUserByClerkUserId(targetUserId);
  if (!user) throw new Error("המשתמש לא נמצא.");
  const code = await createTelegramLinkCode(user.clerk_user_id, 15);
  return {
    ok: true,
    code: code.code,
    expiresAt: code.expiresAt,
    deepLink: buildTelegramDeepLink(code.code)
  };
}

export async function generateUserWhatsAppLinkCodeAction(targetUserId) {
  await requireSuperAdmin();
  const user = await getAppUserByClerkUserId(targetUserId);
  if (!user) throw new Error("המשתמש לא נמצא.");
  const code = await createWhatsAppLinkCode(user.clerk_user_id, 15);
  return {
    ok: true,
    code: code.code,
    expiresAt: code.expiresAt,
    deepLink: buildWhatsAppDeepLink(code.code)
  };
}

export async function unlinkUserTelegramAction(targetUserId) {
  await requireSuperAdmin();
  await unlinkTelegramByClerkUserId(targetUserId);
  revalidatePath("/admin");
}

export async function unlinkUserWhatsAppAction(targetUserId) {
  await requireSuperAdmin();
  await unlinkWhatsAppByClerkUserId(targetUserId);
  revalidatePath("/admin");
}
