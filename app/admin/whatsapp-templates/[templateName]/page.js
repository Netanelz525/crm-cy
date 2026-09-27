import { notFound } from "next/navigation";
import { requireTeamUser } from "../../../../lib/rbac";
import { listWhatsAppCoexistenceApprovedTemplates } from "../../../../lib/attendance-whatsapp";
import { listWhatsAppTemplateConfigs, mergeWhatsAppTemplateConfig, seedWhatsAppTemplateConfigDefaults } from "../../../../lib/whatsapp-template-config";
import { listWhatsAppTemplateActivity } from "../../../../lib/whatsapp-template-registry";
import { AdminPageHeader } from "../../../../app/admin/admin-ui";
import WhatsAppTemplateDetailClient from "../template-detail-client";
import { saveWhatsAppTemplateConfigAction, testWhatsAppTemplateAction } from "../actions";

function clean(value) { return String(value ?? "").trim(); }

export default async function WhatsAppTemplateDetailPage({ params }) {
  const user = await requireTeamUser();
  if (!user.is_manager) return null;
  const routeParams = await params;
  const name = clean(routeParams?.templateName);
  let templates = [];
  let loadError = "";
  try {
    templates = await listWhatsAppCoexistenceApprovedTemplates();
    await seedWhatsAppTemplateConfigDefaults(templates, user.clerk_user_id);
  } catch (error) {
    loadError = error instanceof Error ? error.message : "טעינת התבנית נכשלה.";
  }
  const raw = templates.find((item) => item.name === name);
  if (!raw && !loadError) notFound();
  const configs = await listWhatsAppTemplateConfigs();
  const config = configs.find((item) => item.templateName === name && item.language === (raw?.language || "he"));
  const template = raw ? mergeWhatsAppTemplateConfig(raw, config) : { name, language: "he", status: "לא נטען", bodyText: "", bodyParameterCount: 0, parameterDefinitions: [], buttonLabels: [], headerFormat: "", crmConfig: config };
  const activity = await listWhatsAppTemplateActivity(name);
  return (
    <>
      <AdminPageHeader title={`תבנית WhatsApp: ${template.displayName || name}`} description="עמוד עצמאי לתצוגת התבנית המאושרת, מיפוי שדות ה־CRM ובדיקת שליחה בטוחה למספר אחד." />
      {loadError ? <div className="notice error">{loadError}</div> : null}
      <WhatsAppTemplateDetailClient template={template} saveAction={saveWhatsAppTemplateConfigAction} testAction={testWhatsAppTemplateAction} activity={activity} />
    </>
  );
}
