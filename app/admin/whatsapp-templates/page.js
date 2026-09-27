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
import { listWhatsAppTemplateActivity } from "../../../lib/whatsapp-template-registry";

function clean(value) { return String(value ?? "").trim(); }

export default async function WhatsAppTemplatesPage({ searchParams }) {
  const user = await requireTeamUser();
  if (!user.is_manager) return null;
  const params = await searchParams;
  let templates = [];
  let loadError = "";
  try {
    templates = await listWhatsAppCoexistenceApprovedTemplates();
    await seedWhatsAppTemplateConfigDefaults(templates, user.clerk_user_id);
  } catch (error) {
    loadError = error instanceof Error ? error.message : "טעינת התבניות המאושרות נכשלה.";
  }
  const configs = await listWhatsAppTemplateConfigs();
  const activity = await listWhatsAppTemplateActivity();
  const configByKey = new Map(configs.map((config) => [`${config.templateName}:${config.language}`, config]));
  const merged = templates.map((template) => mergeWhatsAppTemplateConfig(template, configByKey.get(`${template.name}:${template.language}`)));
  return (
    <>
      <AdminPageHeader
        title="ניהול תבניות WhatsApp לתפוצה"
        description="כאן רואים את התבניות שאושרו ב-Dualhook ומגדירים איך ה-CRM משתמש בהן במסלול התפוצה. הבוט התפעולי הפנימי אינו מושפע מההגדרות האלה."
      ><a className="quick-action-btn quick-action-primary" href="/admin/whatsapp-templates/new">יצירת תבנית חדשה</a></AdminPageHeader>
      {clean(params?.created) === "1" ? <div className="ok">בקשת יצירת התבנית נשלחה ל־Dualhook. הסטטוס יתעדכן לאחר תשובת Meta.</div> : null}
      {loadError ? <div className="notice error">{loadError} ניתן לערוך גם הגדרות שכבר נשמרו.</div> : null}
      {activity.length ? <section className="card glass whatsapp-template-activity-summary"><h2>בקשות ופעילות אחרונות</h2><div className="whatsapp-template-activity-list">{activity.slice(0, 12).map((item) => <div className="whatsapp-template-activity-row" key={item.id}><strong>{item.templateName}</strong><span>{item.action === "test" ? "בדיקת שליחה" : "יצירה"} · {item.status}</span><small>{new Date(item.createdAt).toLocaleString("he-IL")}</small>{item.errorMessage ? <em>{item.errorMessage}</em> : null}</div>)}</div></section> : null}
      {!templates.length && !loadError ? <div className="card glass"><p className="muted">לא נמצאו תבניות מאושרות למסלול התפוצה.</p></div> : null}
      <WhatsAppTemplateManager templates={merged} saveAction={saveWhatsAppTemplateConfigAction} />
    </>
  );
}
