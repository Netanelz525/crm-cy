import { initDb, sql } from "./db";
import { getAttendanceSessionById } from "./attendance";
import { listWhatsAppCoexistenceApprovedTemplates, sendAttendanceSessionWhatsAppApprovedTemplate } from "./attendance-whatsapp";
import { validateAttendanceWhatsAppConfig } from "./attendance-whatsapp-config.mjs";

export async function prepareAttendanceWhatsAppConfig(sessionId, input, templates) {
  const session = await getAttendanceSessionById(sessionId);
  if (!session) throw new Error("המפגש לא נמצא.");
  const availableTemplates = templates || await listWhatsAppCoexistenceApprovedTemplates();
  const config = validateAttendanceWhatsAppConfig(input, availableTemplates, session.statusOptions);
  return { config, templates: availableTemplates };
}

export async function saveAttendanceWhatsAppConfig(sessionId, input, templates) {
  const prepared = await prepareAttendanceWhatsAppConfig(sessionId, input, templates);
  await initDb();
  await sql`UPDATE attendance_sessions SET whatsapp_message_config = ${JSON.stringify(prepared.config)}::jsonb, updated_at = NOW() WHERE id = ${sessionId}`;
  return prepared.config;
}

export async function sendSavedAttendanceWhatsAppConfig({ sessionId, config, studentId = "", createdByUserId = "" }) {
  const session = await getAttendanceSessionById(sessionId);
  if (!session) throw new Error("המפגש לא נמצא.");
  if (session.isLocked) throw new Error("המפגש נעול. יש לפתוח אותו לפני שליחה.");
  const prepared = await prepareAttendanceWhatsAppConfig(sessionId, config || session.whatsappMessageConfig);
  return sendAttendanceSessionWhatsAppApprovedTemplate({
    sessionId, ...prepared.config, templates: prepared.templates, studentId, createdByUserId
  });
}
