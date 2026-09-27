import { randomUUID } from "node:crypto";
import { initDb, sql } from "./db";
import { coexistenceWhatsAppConfig } from "./whatsapp-channel-config.mjs";

function clean(value) {
  return String(value ?? "").trim();
}

function safeJson(value, fallback = {}) {
  return value && typeof value === "object" ? value : fallback;
}

function activityStatus(response) {
  const value = clean(response?.status || response?.data?.status || response?.template?.status).toUpperCase();
  return value || "SUBMITTED";
}

export async function recordWhatsAppTemplateActivity(input = {}) {
  await initDb();
  const id = clean(input.id) || randomUUID();
  await sql`
    INSERT INTO whatsapp_template_activity (
      id, template_name, language, action, status, recipient_phone,
      provider_template_id, provider_response, error_message, created_by_user_id
    ) VALUES (
      ${id}, ${clean(input.templateName)}, ${clean(input.language) || "he"},
      ${clean(input.action) || "unknown"}, ${clean(input.status) || "pending"},
      ${clean(input.providerTemplateId) || null}, ${JSON.stringify(safeJson(input.providerResponse))}::jsonb,
      ${clean(input.errorMessage) || null}, ${clean(input.createdByUserId) || null}
    )
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      provider_template_id = EXCLUDED.provider_template_id,
      provider_response = EXCLUDED.provider_response,
      error_message = EXCLUDED.error_message,
      updated_at = NOW()
  `;
  return id;
}

export async function listWhatsAppTemplateActivity(templateName = "") {
  await initDb();
  const rows = clean(templateName)
    ? await sql`
      SELECT * FROM whatsapp_template_activity
      WHERE template_name = ${clean(templateName)}
      ORDER BY created_at DESC LIMIT 50
    `
    : await sql`
      SELECT * FROM whatsapp_template_activity
      ORDER BY created_at DESC LIMIT 100
    `;
  return rows.map((row) => ({
    id: row.id,
    templateName: row.template_name,
    language: row.language,
    action: row.action,
    status: row.status,
    recipientPhone: row.recipient_phone || "",
    providerTemplateId: row.provider_template_id || "",
    providerResponse: safeJson(row.provider_response),
    errorMessage: row.error_message || "",
    createdAt: row.created_at
  }));
}

function normalizeButton(value) {
  return clean(value).slice(0, 20);
}

export async function createWhatsAppTemplate(input = {}) {
  const name = clean(input.name).toLowerCase();
  const language = clean(input.language) || "he";
  const category = clean(input.category).toUpperCase() || "UTILITY";
  const bodyText = clean(input.bodyText);
  const headerFormat = clean(input.headerFormat).toUpperCase();
  const headerText = clean(input.headerText);
  const footerText = clean(input.footerText);
  const buttons = (Array.isArray(input.buttons) ? input.buttons : []).map(normalizeButton).filter(Boolean).slice(0, 3);
  if (!/^[a-z0-9_]{3,512}$/.test(name)) throw new Error("שם התבנית חייב להיות באנגלית, באותיות קטנות, עם קו תחתון בלבד.");
  if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(language)) throw new Error("קוד השפה אינו תקין.");
  if (!["MARKETING", "UTILITY", "AUTHENTICATION"].includes(category)) throw new Error("קטגוריית התבנית אינה תקינה.");
  if (!bodyText) throw new Error("תוכן התבנית חסר.");
  if (!["", "TEXT", "IMAGE", "DOCUMENT"].includes(headerFormat)) throw new Error("סוג הכותרת אינו נתמך.");
  if (headerFormat === "TEXT" && !headerText) throw new Error("יש להזין טקסט לכותרת.");
  const components = [];
  if (headerFormat === "TEXT") components.push({ type: "HEADER", format: "TEXT", text: headerText });
  if (headerFormat === "IMAGE" || headerFormat === "DOCUMENT") {
    const handle = clean(input.headerHandle);
    components.push({
      type: "HEADER",
      format: headerFormat,
      ...(handle ? { example: { header_handle: [handle] } } : {})
    });
  }
  const body = { type: "BODY", text: bodyText };
  const examples = Array.isArray(input.bodyExamples) ? input.bodyExamples.map(clean).filter(Boolean).slice(0, 20) : [];
  if (examples.length) body.example = { body_text: [examples] };
  components.push(body);
  if (footerText) components.push({ type: "FOOTER", text: footerText });
  if (buttons.length) components.push({ type: "BUTTONS", buttons: buttons.map((text) => ({ type: "QUICK_REPLY", text })) });

  const config = coexistenceWhatsAppConfig();
  const activityId = randomUUID();
  const requestBody = { name, language, category, components };
  await recordWhatsAppTemplateActivity({ id: activityId, templateName: name, language, action: "create", status: "pending", providerResponse: { requestBody }, createdByUserId: input.createdByUserId });
  try {
    const response = await fetch(config.templatesUrl, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(clean(data?.error?.message || data?.message) || `Dualhook דחה את יצירת התבנית (${response.status}).`);
    await recordWhatsAppTemplateActivity({ id: activityId, templateName: name, language, action: "create", status: activityStatus(data), providerTemplateId: data?.id || data?.template_id || data?.data?.id, providerResponse: data, createdByUserId: input.createdByUserId });
    return { ...data, activityId, requestBody };
  } catch (error) {
    await recordWhatsAppTemplateActivity({ id: activityId, templateName: name, language, action: "create", status: "ERROR", errorMessage: clean(error?.message) || "יצירת התבנית נכשלה.", createdByUserId: input.createdByUserId });
    throw error;
  }
}
