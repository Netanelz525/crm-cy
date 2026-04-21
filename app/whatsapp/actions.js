"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "../../lib/rbac";
import {
  createWhatsAppLinkCode,
  getWhatsAppLinkByClerkUserId,
  unlinkWhatsAppByClerkUserId
} from "../../lib/whatsapp";

export async function generateWhatsAppLinkCodeAction() {
  const user = await requireAuthenticatedUser();
  if (!user.is_team_member && !user.is_manager) {
    throw new Error("רק משתמשים מורשים יכולים לחבר WhatsApp.");
  }
  const link = await getWhatsAppLinkByClerkUserId(user.clerk_user_id);
  if (link?.whatsapp_wa_id) {
    return {
      ok: true,
      alreadyLinked: true
    };
  }
  const code = await createWhatsAppLinkCode(user.clerk_user_id, 15);
  revalidatePath("/whatsapp");
  return {
    ok: true,
    code: code.code,
    expiresAt: code.expiresAt
  };
}

export async function unlinkWhatsAppAction() {
  const user = await requireAuthenticatedUser();
  if (!user.is_team_member && !user.is_manager) {
    throw new Error("רק משתמשים מורשים יכולים לנתק WhatsApp.");
  }
  await unlinkWhatsAppByClerkUserId(user.clerk_user_id);
  revalidatePath("/whatsapp");
}
