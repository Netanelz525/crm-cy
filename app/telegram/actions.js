"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "../../lib/rbac";
import {
  createTelegramLinkCode,
  getTelegramLinkByClerkUserId,
  setTelegramWebhook,
  unlinkTelegramByClerkUserId
} from "../../lib/telegram";

function resolveBaseUrl() {
  const explicit = process.env.CRM_BASE_URL || process.env.APP_BASE_URL;
  if (explicit) return String(explicit).trim().replace(/\/$/, "");
  const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercelUrl) {
    const host = String(vercelUrl).trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
    return `https://${host}`;
  }
  return "";
}

export async function generateTelegramLinkCodeAction() {
  const user = await requireAuthenticatedUser();
  if (!user.is_team_member && !user.is_manager) {
    throw new Error("רק משתמשים מורשים יכולים לחבר Telegram.");
  }
  const link = await getTelegramLinkByClerkUserId(user.clerk_user_id);
  if (link?.telegram_chat_id) {
    return {
      ok: true,
      alreadyLinked: true
    };
  }
  const code = await createTelegramLinkCode(user.clerk_user_id, 15);
  revalidatePath("/telegram");
  return {
    ok: true,
    code: code.code,
    expiresAt: code.expiresAt
  };
}

export async function unlinkTelegramAction() {
  const user = await requireAuthenticatedUser();
  if (!user.is_team_member && !user.is_manager) {
    throw new Error("רק משתמשים מורשים יכולים לנתק Telegram.");
  }
  await unlinkTelegramByClerkUserId(user.clerk_user_id);
  revalidatePath("/telegram");
}

export async function setupTelegramWebhookAction() {
  const user = await requireAuthenticatedUser();
  if (!user.is_team_member && !user.is_manager) {
    throw new Error("רק משתמשים מורשים יכולים להגדיר webhook.");
  }
  const baseUrl = resolveBaseUrl();
  if (!baseUrl) {
    throw new Error("חסר APP_BASE_URL או CRM_BASE_URL.");
  }
  await setTelegramWebhook(`${baseUrl}/api/telegram/webhook`);
  return {
    ok: true,
    webhookUrl: `${baseUrl}/api/telegram/webhook`
  };
}
