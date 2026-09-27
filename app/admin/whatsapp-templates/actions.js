"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTeamUser } from "../../../lib/rbac";
import { upsertWhatsAppTemplateConfig } from "../../../lib/whatsapp-template-config";
import { listWhatsAppCoexistenceApprovedTemplates, sendWhatsAppTemplateTest, uploadAttendanceWhatsAppImage } from "../../../lib/attendance-whatsapp";
import { createWhatsAppTemplate, recordWhatsAppTemplateActivity } from "../../../lib/whatsapp-template-registry";

function clean(value) { return String(value ?? "").trim(); }

function limitParameterValue(value) {
  return clean(value).replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").split(" ").filter(Boolean).slice(0, 4).join(" ");
}

export async function saveWhatsAppTemplateConfigAction(formData) {
  const user = await requireTeamUser();
  if (!user.is_manager) throw new Error("אין הרשאה לניהול תבניות WhatsApp.");
  const raw = formData.get("config");
  if (typeof raw !== "string") throw new Error("הגדרת התבנית חסרה.");
  const config = JSON.parse(raw);
  await upsertWhatsAppTemplateConfig({ config, userId: user.clerk_user_id });
  revalidatePath("/admin/whatsapp-templates");
  revalidatePath(`/admin/whatsapp-templates/${encodeURIComponent(clean(config.templateName))}`);
}

export async function testWhatsAppTemplateAction(previousState, formData) {
  const user = await requireTeamUser();
  if (!user.is_manager) return { ok: false, message: "אין הרשאה לבדיקת תבניות." };
  const templateName = clean(formData.get("templateName"));
  const language = clean(formData.get("language")) || "he";
  const phone = clean(formData.get("phone"));
  const values = clean(formData.get("values"));
  let activityId = "";
  try {
    const templates = await listWhatsAppCoexistenceApprovedTemplates();
    const template = templates.find((item) => item.name === templateName && item.language === language) || templates.find((item) => item.name === templateName);
    if (!template) throw new Error("התבנית אינה מופיעה כרגע כמאושרת ב-Dualhook.");
    activityId = await recordWhatsAppTemplateActivity({ templateName, language: template.language, action: "test", status: "pending", recipientPhone: phone, createdByUserId: user.clerk_user_id });
    const file = formData.get("media");
    const mediaId = file && typeof file.arrayBuffer === "function" && file.size ? await uploadAttendanceWhatsAppImage(file) : "";
    const parsedValues = JSON.parse(values || "[]");
    const normalizedValues = Array.isArray(parsedValues) ? parsedValues.map(limitParameterValue) : [];
    const response = await sendWhatsAppTemplateTest({ template, phone, values: normalizedValues, mediaId });
    await recordWhatsAppTemplateActivity({ id: activityId, templateName, language: template.language, action: "test", status: "SENT", recipientPhone: phone, providerResponse: response, createdByUserId: user.clerk_user_id });
    revalidatePath(`/admin/whatsapp-templates/${encodeURIComponent(templateName)}`);
    return { ok: true, message: "הודעת הבדיקה נשלחה בהצלחה." };
  } catch (error) {
    if (activityId) await recordWhatsAppTemplateActivity({ id: activityId, templateName, language, action: "test", status: "ERROR", recipientPhone: phone, errorMessage: clean(error?.message) || "שליחת הבדיקה נכשלה.", createdByUserId: user.clerk_user_id });
    return { ok: false, message: clean(error?.message) || "שליחת הבדיקה נכשלה." };
  }
}

export async function createWhatsAppTemplateAction(formData) {
  const user = await requireTeamUser();
  if (!user.is_manager) redirect("/unauthorized");
  const bodyExamples = clean(formData.get("bodyExamples")).split("|").map(clean).filter(Boolean);
  try {
    await createWhatsAppTemplate({
      name: formData.get("name"),
      language: formData.get("language"),
      category: formData.get("category"),
      bodyText: formData.get("bodyText"),
      bodyExamples,
      headerFormat: formData.get("headerFormat"),
      headerText: formData.get("headerText"),
      headerHandle: formData.get("headerHandle"),
      footerText: formData.get("footerText"),
      buttons: formData.getAll("buttons"),
      createdByUserId: user.clerk_user_id
    });
  } catch (error) {
    redirect(`/admin/whatsapp-templates/new?error=${encodeURIComponent(clean(error?.message) || "יצירת התבנית נכשלה.")}`);
  }
  revalidatePath("/admin/whatsapp-templates");
  redirect("/admin/whatsapp-templates?created=1");
}
