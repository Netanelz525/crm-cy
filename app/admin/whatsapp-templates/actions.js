"use server";

import { revalidatePath } from "next/cache";
import { requireTeamUser } from "../../../lib/rbac";
import { upsertWhatsAppTemplateConfig } from "../../../lib/whatsapp-template-config";

export async function saveWhatsAppTemplateConfigAction(formData) {
  const user = await requireTeamUser();
  if (!user.is_manager) throw new Error("אין הרשאה לניהול תבניות WhatsApp.");
  const raw = formData.get("config");
  if (typeof raw !== "string") throw new Error("הגדרת התבנית חסרה.");
  const config = JSON.parse(raw);
  await upsertWhatsAppTemplateConfig({ config, userId: user.clerk_user_id });
  revalidatePath("/admin/whatsapp-templates");
}
