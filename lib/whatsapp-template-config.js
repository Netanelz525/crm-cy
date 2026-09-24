import { randomUUID } from "crypto";
import { initDb, sql } from "./db";
import { WHATSAPP_TEMPLATE_PURPOSES, WHATSAPP_TEMPLATE_SOURCES } from "./whatsapp-template-config-shared";

export { WHATSAPP_TEMPLATE_PURPOSES, WHATSAPP_TEMPLATE_SOURCES } from "./whatsapp-template-config-shared";

function clean(value) {
  return String(value ?? "").trim();
}

function parseJson(value, fallback) {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function inferPurpose(template) {
  const name = clean(template?.name).toLowerCase();
  if (name.includes("invitation")) return "attendance_invitation";
  if (name.includes("parent") && (name.includes("meeting") || name.includes("status"))) return "attendance_parent_status";
  if (name.includes("attendance") || name.includes("status_update")) return "attendance_status";
  if (name.includes("general_person")) return "general_personal";
  return "general_broadcast";
}

function sourceForDefinition(definition) {
  const source = clean(definition?.source);
  if (source === "recipient") return "recipient_name";
  if (source === "student") return "student_name";
  if (source === "responseStatus:1") return "response_status_1";
  if (source === "responseStatus:2") return "response_status_2";
  if (source === "session") return "meeting_title";
  return "free_text";
}

export function defaultWhatsAppTemplateConfig(template) {
  const purpose = inferPurpose(template);
  const headerFormat = clean(template?.headerFormat).toUpperCase();
  const isParent = purpose === "attendance_parent_status";
  const isInvitation = purpose === "attendance_invitation";
  const parameterMappings = (Array.isArray(template?.parameterDefinitions) ? template.parameterDefinitions : []).map((definition) => ({
    index: Number(definition.index) || 0,
    parameterName: clean(definition.parameterName),
    source: sourceForDefinition(definition),
    value: ""
  })).filter((mapping) => mapping.index > 0);
  const buttonMappings = (Array.isArray(template?.buttons) ? template.buttons : [])
    .filter((button) => ["QUICK_REPLY", "QUICK_REPLY_BUTTON"].includes(clean(button.type).toUpperCase()))
    .map((button, index) => ({
      index: Number.isInteger(button.index) ? button.index : index,
      label: clean(button.text),
      source: index === 0 ? "response_status_1" : "response_status_2"
    }));
  return {
    templateName: clean(template?.name),
    language: clean(template?.language) || "he",
    channel: "broadcast",
    purpose,
    internalDescription: WHATSAPP_TEMPLATE_PURPOSES[purpose],
    enabled: true,
    preferred: false,
    requiresMedia: Boolean(template?.requiresMedia),
    mediaType: headerFormat === "IMAGE" ? "image" : headerFormat === "DOCUMENT" ? "document" : "none",
    recipientRoles: isInvitation ? ["student", "father", "mother"] : isParent ? ["father", "mother"] : ["student"],
    parameterMappings,
    buttonMappings
  };
}

function normalizeConfig(config) {
  const allowedSources = new Set(Object.keys(WHATSAPP_TEMPLATE_SOURCES));
  const allowedRoles = new Set(["student", "father", "mother"]);
  const allowedMedia = new Set(["none", "image", "document"]);
  const allowedPurposes = new Set(Object.keys(WHATSAPP_TEMPLATE_PURPOSES));
  const parameterMappings = Array.isArray(config.parameterMappings) ? config.parameterMappings.map((mapping) => ({
    index: Math.max(0, Number(mapping.index) || 0),
    parameterName: clean(mapping.parameterName).slice(0, 100),
    source: allowedSources.has(clean(mapping.source)) ? clean(mapping.source) : "free_text",
    value: clean(mapping.value).slice(0, 1000)
  })).filter((mapping) => mapping.index > 0).slice(0, 30) : [];
  const buttonMappings = Array.isArray(config.buttonMappings) ? config.buttonMappings.map((mapping) => ({
    index: Math.max(0, Number(mapping.index) || 0),
    label: clean(mapping.label).slice(0, 100),
    source: allowedSources.has(clean(mapping.source)) ? clean(mapping.source) : ""
  })).filter((mapping) => mapping.index >= 0).slice(0, 10) : [];
  return {
    templateName: clean(config.templateName).slice(0, 200),
    language: clean(config.language).slice(0, 20) || "he",
    channel: "broadcast",
    purpose: allowedPurposes.has(clean(config.purpose)) ? clean(config.purpose) : "other",
    internalDescription: clean(config.internalDescription).slice(0, 500),
    enabled: config.enabled !== false,
    preferred: config.preferred === true,
    requiresMedia: config.requiresMedia === true,
    mediaType: allowedMedia.has(clean(config.mediaType)) ? clean(config.mediaType) : "none",
    recipientRoles: Array.isArray(config.recipientRoles) ? config.recipientRoles.filter((role) => allowedRoles.has(role)).slice(0, 3) : [],
    parameterMappings,
    buttonMappings
  };
}

export async function listWhatsAppTemplateConfigs() {
  await initDb();
  const rows = await sql`SELECT * FROM whatsapp_template_configs WHERE channel = 'broadcast' ORDER BY template_name ASC`;
  return rows.map((row) => ({
    id: row.id,
    templateName: row.template_name,
    language: row.language,
    channel: row.channel,
    purpose: row.purpose,
    internalDescription: row.internal_description || "",
    enabled: row.enabled !== false,
    preferred: row.preferred === true,
    requiresMedia: row.requires_media === true,
    mediaType: row.media_type || "none",
    recipientRoles: Array.isArray(row.recipient_roles) ? row.recipient_roles : [],
    parameterMappings: parseJson(row.parameter_mappings, []),
    buttonMappings: parseJson(row.button_mappings, [])
  }));
}

export async function seedWhatsAppTemplateConfigDefaults(templates, userId = null) {
  await initDb();
  for (const template of Array.isArray(templates) ? templates : []) {
    const defaults = defaultWhatsAppTemplateConfig(template);
    if (!defaults.templateName) continue;
    await sql`
      INSERT INTO whatsapp_template_configs (
        id, template_name, language, channel, purpose, internal_description,
        enabled, preferred, requires_media, media_type, recipient_roles,
        parameter_mappings, button_mappings, created_by_user_id
      ) VALUES (
        ${randomUUID()}, ${defaults.templateName}, ${defaults.language}, 'broadcast',
        ${defaults.purpose}, ${defaults.internalDescription}, TRUE, FALSE,
        ${defaults.requiresMedia}, ${defaults.mediaType}, ${defaults.recipientRoles},
        ${JSON.stringify(defaults.parameterMappings)}::jsonb,
        ${JSON.stringify(defaults.buttonMappings)}::jsonb, ${userId || null}
      )
      ON CONFLICT (template_name, language, channel) DO NOTHING
    `;
  }
}

export async function upsertWhatsAppTemplateConfig(input) {
  await initDb();
  const config = normalizeConfig(input?.config || input || {});
  if (!config.templateName) throw new Error("שם התבנית חסר.");
  await sql`
    INSERT INTO whatsapp_template_configs (
      id, template_name, language, channel, purpose, internal_description,
      enabled, preferred, requires_media, media_type, recipient_roles,
      parameter_mappings, button_mappings, created_by_user_id
    ) VALUES (
      ${randomUUID()}, ${config.templateName}, ${config.language}, 'broadcast',
      ${config.purpose}, ${config.internalDescription}, ${config.enabled}, ${config.preferred},
      ${config.requiresMedia}, ${config.mediaType}, ${config.recipientRoles},
      ${JSON.stringify(config.parameterMappings)}::jsonb,
      ${JSON.stringify(config.buttonMappings)}::jsonb, ${input?.userId || null}
    )
    ON CONFLICT (template_name, language, channel) DO UPDATE SET
      purpose = EXCLUDED.purpose,
      internal_description = EXCLUDED.internal_description,
      enabled = EXCLUDED.enabled,
      preferred = EXCLUDED.preferred,
      requires_media = EXCLUDED.requires_media,
      media_type = EXCLUDED.media_type,
      recipient_roles = EXCLUDED.recipient_roles,
      parameter_mappings = EXCLUDED.parameter_mappings,
      button_mappings = EXCLUDED.button_mappings,
      updated_at = NOW()
  `;
  return config;
}

export function mergeWhatsAppTemplateConfig(template, config) {
  return { ...template, crmConfig: config || defaultWhatsAppTemplateConfig(template) };
}
