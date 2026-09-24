import { requireTeamUser } from "../../../lib/rbac";
import { listWhatsAppCoexistenceApprovedTemplates } from "../../../lib/attendance-whatsapp";
import {
  listWhatsAppTemplateConfigs,
  mergeWhatsAppTemplateConfig,
  seedWhatsAppTemplateConfigDefaults
} from "../../../lib/whatsapp-template-config";
import { AdminPageHeader } from "../admin-ui";
import WhatsAppTemplateManager from "./whatsapp-template-manager";
import { saveWhatsAppTemplateConfigAction } from "./actions";

export default async function WhatsAppTemplatesPage() {
  const user = await requireTeamUser();
  if (!user.is_manager) return null;
  let templates = [];
  let loadError = "";
  try {
    templates = await listWhatsAppCoexistenceApprovedTemplates();
    await seedWhatsAppTemplateConfigDefaults(templates, user.clerk_user_id);
  } catch (error) {
    loadError = error instanceof Error ? error.message : "טעינת התבניות המאושרות נכשלה.";
  }
  const configs = await listWhatsAppTemplateConfigs();
  const configByKey = new Map(configs.map((config) => [`${config.templateName}:${config.language}`, config]));
  const merged = templates.map((template) => mergeWhatsAppTemplateConfig(template, configByKey.get(`${template.name}:${template.language}`)));
  return (
    <>
      <AdminPageHeader
        title="ניהול תבניות WhatsApp לתפוצה"
        description="כאן רואים את התבניות שאושרו ב-Dualhook ומגדירים איך ה-CRM משתמש בהן במסלול התפוצה. הבוט התפעולי הפנימי אינו מושפע מההגדרות האלה."
      />
      {loadError ? <div className="notice error">{loadError} ניתן לערוך גם הגדרות שכבר נשמרו.</div> : null}
      {!templates.length && !loadError ? <div className="card glass"><p className="muted">לא נמצאו תבניות מאושרות למסלול התפוצה.</p></div> : null}
      <WhatsAppTemplateManager templates={merged} saveAction={saveWhatsAppTemplateConfigAction} />
    </>
  );
}
