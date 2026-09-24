import { randomUUID } from "node:crypto";
import { initDb, sql } from "./db";
import {
  buildAttendanceStatusLabels,
  getAttendanceRoster,
  normalizeAttendanceStatus,
  saveAttendanceRecord
} from "./attendance";
import { getNeonStudentById } from "./neon-students";
import { coexistenceWhatsAppConfig } from "./whatsapp-channel-config.mjs";

const TEMPLATE_NAME = "attendance_status_update_v1";
const PARENT_TEMPLATE_NAME = "attendance_parent_status_update_v1";
const PARENT_MEETING_TEMPLATE_NAME = "parent_meeting_response_v1";
const PARENT_MEETING_IMAGE_TEMPLATE_NAME = "parent_meeting_image_response_v1";
const GENERAL_TEMPLATE_NAME = "general_person_response_v1";
const GENERAL_IMAGE_TEMPLATE_NAME = "general_person_image_response_v1";
const TEMPLATE_LANGUAGE = "he";

function clean(value) {
  return String(value || "").trim();
}

function isInvitationTemplateName(value) {
  const name = clean(value).toLowerCase();
  return name.startsWith("general_meeting_invitation") || name.includes("meeting_invitation");
}

export function templateHeaderMediaType(template) {
  const format = clean(
    template?.headerFormat ||
      template?.header?.format ||
      template?.header?.mediaType ||
      template?.mediaType,
  ).toUpperCase();
  if (format === "IMAGE") return "image";
  if (format === "DOCUMENT") return "document";

  // Some Dualhook responses only expose the approved template name. Keep the
  // fallback here so a media template can never be sent with an UNKNOWN header.
  const name = clean(template?.name || template?.templateName).toLowerCase();
  if (name.includes("image")) return "image";
  if (name.includes("document") || name.includes("pdf")) return "document";

  return "";
}

function unique(values) {
  return Array.from(new Set((Array.isArray(values) ? values : [values]).map(clean).filter(Boolean)));
}

function normalizePhone(value) {
  let digits = clean(value).replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `972${digits.slice(1)}`;
  if (!digits.startsWith("972") && digits.length === 9) digits = `972${digits}`;
  return /^972\d{8,9}$/.test(digits) ? digits : "";
}

function phoneValue(field) {
  if (!field) return "";
  if (typeof field === "string" || typeof field === "number") return normalizePhone(field);
  const calling = clean(field.primaryPhoneCallingCode || field.callingCode).replace(/\D/g, "");
  const number = clean(field.primaryPhoneNumber || field.number);
  if (calling && number) return normalizePhone(`${calling}${number}`);
  return normalizePhone(number);
}

function recipientPhones(student, roles) {
  const options = {
    student: { value: phoneValue(student?.phone || student?.studentPhone), label: [clean(student?.title), clean(student?.label)].filter(Boolean).join(" "), role: "student" },
    father: { value: phoneValue(student?.dadPhone || student?.fatherPhone), label: [clean(student?.fatherTitle), clean(student?.shmHb || student?.fatherName)].filter(Boolean).join(" "), role: "father" },
    mother: { value: phoneValue(student?.momPhone || student?.motherPhone), label: [clean(student?.motherTitle), clean(student?.shmHm || student?.motherName)].filter(Boolean).join(" "), role: "mother" }
  };
  const seen = new Set();
  return unique(roles).map((role) => options[role]).filter((item) => {
    if (!item?.value || seen.has(item.value)) return false;
    seen.add(item.value);
    return true;
  });
}

async function ensureTokenTable() {
  await initDb();
  await sql`
    CREATE TABLE IF NOT EXISTS attendance_whatsapp_response_tokens (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL,
      recipient_phone TEXT NOT NULL,
      recipient_role TEXT,
      status TEXT NOT NULL,
      created_by_user_id TEXT REFERENCES app_users(clerk_user_id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      used_at TIMESTAMPTZ
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_attendance_wa_tokens_session ON attendance_whatsapp_response_tokens (session_id, created_at DESC)`;
}

async function createResponseToken({ sessionId, studentId, phone, role, status, createdByUserId }) {
  await ensureTokenTable();
  const id = randomUUID();
  await sql`
    INSERT INTO attendance_whatsapp_response_tokens
      (id, session_id, student_id, recipient_phone, recipient_role, status, created_by_user_id)
    VALUES
      (${id}, ${clean(sessionId)}, ${clean(studentId)}, ${clean(phone)}, ${clean(role)}, ${normalizeAttendanceStatus(status)}, ${clean(createdByUserId) || null})
  `;
  return `attendance:${id}`;
}

async function sendTemplate(payload) {
  const config = coexistenceWhatsAppConfig();
  const response = await fetch(config.messagesUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = data?.error?.error_data?.details || data?.error?.error_user_msg;
    throw new Error([clean(data?.error?.message), clean(details)].filter(Boolean).join(" — ") || `WhatsApp send failed (${response.status})`);
  }
  return data;
}

export async function uploadAttendanceWhatsAppImage(file) {
  if (!file || typeof file.arrayBuffer !== "function" || !file.size) return "";
  const config = coexistenceWhatsAppConfig();
  const mimeType = clean(file.type).toLowerCase();
  if (!["image/jpeg", "image/png", "application/pdf"].includes(mimeType)) throw new Error("אפשר לצרף תמונת JPG, PNG או PDF בלבד.");
  if (file.size > 30 * 1024 * 1024) throw new Error("גודל הקובץ המרבי הוא 30MB.");
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", file, clean(file.name) || "attendance-image");
  const response = await fetch(`${config.baseUrl}/${config.version}/${config.phoneNumberId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.accessToken}` },
    body: form
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !clean(data?.id)) throw new Error(clean(data?.error?.message) || "העלאת הקובץ ל-WhatsApp נכשלה.");
  return clean(data.id);
}

export async function sendAttendanceSessionWhatsApp({
  sessionId,
  personalMessage = "",
  responseStatuses = [],
  targetStatuses = [],
  recipientRoles = [],
  testPhone = "",
  testStudentId = "",
  imageUrl = "",
  imageId = "",
  useGenericTemplate = false,
  createdByUserId = ""
}) {
  const roster = await getAttendanceRoster(sessionId);
  if (!roster) throw new Error("המפגש לא נמצא.");
  const labels = buildAttendanceStatusLabels(roster.session.customStatuses);
  const isParentAudience = ["parents", "parent_meeting"].includes(roster.session.communicationAudience);
  const isDirectParentMeeting = roster.session.communicationAudience === "parent_meeting";
  const hasImage = Boolean(clean(imageId) || clean(imageUrl));
  if (hasImage && !useGenericTemplate && !isDirectParentMeeting) {
    throw new Error("תמונה נתמכת בתבנית הכללית או בתבנית פגישה ישירה עם ההורים.");
  }
  const statuses = unique(responseStatuses).map(normalizeAttendanceStatus).filter((value) => labels[value]);
  if (statuses.length !== 2) throw new Error("לשליחת WhatsApp יש לבחור בדיוק שני סטטוסים לעדכון.");
  const sendStatuses = unique(targetStatuses).map(normalizeAttendanceStatus).filter((value) => labels[value]);
  let students = roster.students.filter((student) => !sendStatuses.length || sendStatuses.includes(normalizeAttendanceStatus(student.status)));
  if (clean(testStudentId)) students = students.filter((student) => clean(student.id) === clean(testStudentId));
  if (!students.length) throw new Error("לא נמצאו תלמידים מתאימים לשליחה.");

  let sent = 0;
  let failed = 0;
  let missingPhones = 0;
  for (const rosterStudent of students) {
    const student = await getNeonStudentById(rosterStudent.id);
    if (!student) continue;
    const effectiveRoles = isParentAudience ? ["father", "mother"] : ["student"];
    const recipients = clean(testPhone)
      ? [{ value: normalizePhone(testPhone), label: "בדיקה", role: "test" }]
      : recipientPhones(student, effectiveRoles);
    if (!recipients.length) { missingPhones += 1; continue; }
    for (const recipient of recipients) {
      const payloads = await Promise.all(statuses.map((status) => createResponseToken({
        sessionId: roster.session.id,
        studentId: student.id,
        phone: recipient.value,
        role: recipient.role,
        status,
        createdByUserId
      })));
      const bodyParameters = useGenericTemplate ? [
        { type: "text", text: clean(recipient.label) || "שלום" },
        { type: "text", text: clean(personalMessage) || "נשמח לקבל את תשובתכם." },
        { type: "text", text: labels[statuses[0]] },
        { type: "text", text: labels[statuses[1]] }
      ] : isDirectParentMeeting ? [
        { type: "text", text: clean(recipient.label) || "שלום" },
        { type: "text", text: clean(roster.session.title) || "הפגישה" },
        { type: "text", text: clean(personalMessage) || "נשמח לקבל את תשובתכם." },
        { type: "text", text: labels[statuses[0]] },
        { type: "text", text: labels[statuses[1]] }
      ] : [
        { type: "text", text: clean(recipient.label) || "שלום" },
        { type: "text", text: clean(roster.session.title) || "המפגש" },
        { type: "text", text: clean(personalMessage) || "נשמח לעדכון הסטטוס." },
        { type: "text", text: clean(student.label) || clean(rosterStudent.label) || "התלמיד" },
        { type: "text", text: labels[statuses[0]] },
        { type: "text", text: labels[statuses[1]] }
      ];
      const components = [{
        type: "body",
        parameters: bodyParameters
      }];
      if (hasImage) {
        components.unshift({
          type: "header",
          parameters: [{ type: "image", image: clean(imageId) ? { id: clean(imageId) } : { link: clean(imageUrl) } }]
        });
      }
      components.push(
        { type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: payloads[0] }] },
        { type: "button", sub_type: "quick_reply", index: "1", parameters: [{ type: "payload", payload: payloads[1] }] }
      );
      try {
        await sendTemplate({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: recipient.value,
          type: "template",
          template: {
            name: useGenericTemplate
              ? (hasImage ? GENERAL_IMAGE_TEMPLATE_NAME : GENERAL_TEMPLATE_NAME)
              : isDirectParentMeeting
              ? ((clean(imageId) || clean(imageUrl)) ? PARENT_MEETING_IMAGE_TEMPLATE_NAME : PARENT_MEETING_TEMPLATE_NAME)
              : (isParentAudience ? PARENT_TEMPLATE_NAME : TEMPLATE_NAME),
            language: { code: TEMPLATE_LANGUAGE },
            components
          }
        });
        sent += 1;
      } catch (error) {
        failed += 1;
        console.error("Attendance WhatsApp send failed", { sessionId, studentId: student.id, error: clean(error?.message) });
      }
    }
  }
  return { sent, failed, missingPhones, matchedStudents: students.length };
}

function formatIsraeliDate(value) {
  const match = clean(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : clean(value);
}

function mappedTemplateValue(mapping, { recipient, student, session, statusLabel, responseStatusLabels = [] }) {
  const source = clean(mapping?.source).toLowerCase();
  if (["recipient_name", "recipient"].includes(source)) return clean(recipient?.label) || "נמען";
  if (["student_name", "student"].includes(source)) return clean(student?.label) || "תלמיד";
  if (source === "class") return clean(student?.class) || "-";
  if (["meeting_title", "session"].includes(source)) return clean(session?.displayTitle || session?.title || session?.sessionTypeLabel) || "מפגש";
  if (["meeting_message", "invitation_message", "message", "free_text", "free"].includes(source)) return clean(session?.invitationMessage || session?.invitationEmailBody || session?.personalMessage) || "-";
  if (["meeting_date", "date"].includes(source)) return formatIsraeliDate(session?.sessionDate) || "-";
  if (["attendance_status", "status"].includes(source)) return clean(statusLabel) || "-";
  if (["response_status_1", "responsestatus:1"].includes(source)) return clean(responseStatusLabels[0]) || "-";
  if (["response_status_2", "responsestatus:2"].includes(source)) return clean(responseStatusLabels[1]) || "-";
  if (source === "institution") return clean(session?.institutionLabel) || "-";
  return clean(mapping?.value) || "-";
}

function templateParameters(template, context, parameterMappings = []) {
  const count = templateBodyParameterCount(template);
  return Array.from({ length: count }, (_, offset) => mappedTemplateValue(parameterMappings[offset], context));
}

export function templateBodyParameters(template, values) {
  const parameters = Array.isArray(values) ? values : [];
  if (template?.parameterFormat !== "named") {
    return parameters.map((text) => ({ type: "text", text }));
  }

  const definitions = Array.isArray(template?.parameterDefinitions) ? template.parameterDefinitions : [];
  return parameters.map((text, index) => {
    const parameterName = clean(definitions[index]?.parameterName || definitions[index]?.name);
    if (!parameterName) {
      throw new Error("לתבנית המאושרת חסר שם של משתנה בגוף ההודעה.");
    }
    return { type: "text", parameter_name: parameterName, text };
  });
}

export async function sendAttendanceSessionWhatsAppApprovedTemplate({
  sessionId,
  templateName,
  templateLanguage = "he",
  recipientRoles = ["student"],
  responseStatuses = [],
  targetStatuses = [],
  templates = [],
  parameterMappings = [],
  parameterOverrides = {},
  imageId = "",
  mediaType = "image",
  studentId = "",
  invitation = false,
  createdByUserId = ""
}) {
  const roster = await getAttendanceRoster(sessionId);
  if (!roster) throw new Error("המפגש לא נמצא.");
  const availableTemplates = Array.isArray(templates) ? templates : [];
  const template = availableTemplates.find((item) =>
    clean(item?.name) === clean(templateName)
    && clean(item?.language || templateLanguage || "he").toLowerCase() === clean(templateLanguage || "he").toLowerCase()
  ) || availableTemplates.find((item) => clean(item?.name) === clean(templateName));
  if (!template) throw new Error("יש לבחור תבנית WhatsApp מאושרת.");
  const isInvitationTemplate = isInvitationTemplateName(template.name);
  if (isInvitationTemplate && !invitation) {
    throw new Error("תבנית הזמנה נשלחת רק מתוך אזור ההזמנה של המפגש.");
  }
  const headerMediaType = templateHeaderMediaType(template);
  const requiresMedia = Boolean(headerMediaType || template.requiresMedia);
  if (requiresMedia && !headerMediaType) {
    throw new Error("לתבנית WhatsApp חסר סוג מדיה בכותרת.");
  }
  if (requiresMedia && !clean(imageId)) throw new Error("התבנית שנבחרה דורשת קובץ בכותרת.");
  const labels = buildAttendanceStatusLabels(roster.session.customStatuses);
  const quickReplyButtons = (Array.isArray(template.buttons) ? template.buttons : [])
    .filter((button) => ["QUICK_REPLY", "QUICK_REPLY_BUTTON"].includes(clean(button?.type || button?.subType).toUpperCase()));
  // Invitation templates are informational messages. They must never create
  // attendance response tokens or quick-reply components, even if stale UI
  // state still contains response statuses.
  const statuses = isInvitationTemplate
    ? []
    : unique(responseStatuses).map(normalizeAttendanceStatus).filter((value) => labels[value]);
  if (isInvitationTemplate && quickReplyButtons.length) throw new Error("תבנית הזמנה צריכה להיות ללא כפתורי עדכון.");
  if (!isInvitationTemplate && statuses.length !== quickReplyButtons.length) {
    throw new Error(quickReplyButtons.length
      ? `יש לבחור בדיוק ${quickReplyButtons.length} סטטוסים לעדכון מצב הנוכחות מתוך WhatsApp.`
      : "לתבנית שנבחרה אין כפתורי עדכון סטטוס.");
  }
  const allowedStatuses = new Set(unique(targetStatuses).map(normalizeAttendanceStatus));
  const effectiveMappings = parameterMappings.length
    ? parameterMappings
    : (Array.isArray(template.parameterDefinitions) ? template.parameterDefinitions : []).map((definition) => ({
      source: clean(definition.source).replace(/^responseStatus:/, "response_status_").replace(/^free$/, "free_text"),
      value: parameterOverrides[String(definition.index)] || ""
    }));
  const students = roster.students.filter((student) =>
    (!clean(studentId) || clean(student.id) === clean(studentId))
    && (isInvitationTemplate || !allowedStatuses.size || allowedStatuses.has(normalizeAttendanceStatus(student.status)))
  );
  if (!students.length) throw new Error("לא נמצאו תלמידים מתאימים לשליחה.");
  let sentMessages = 0;
  let failedMessages = 0;
  let missingRecipients = 0;
  const errors = [];
  for (const rosterStudent of students) {
    const student = await getNeonStudentById(rosterStudent.id);
    if (!student) continue;
    const recipients = recipientPhones(student, recipientRoles);
    if (!recipients.length) {
      missingRecipients += 1;
      continue;
    }
    for (const recipient of recipients) {
      try {
        const responsePayloads = await Promise.all(statuses.map((status) => createResponseToken({
          sessionId: roster.session.id,
          studentId: student.id,
          phone: recipient.value,
          role: recipient.role,
          status,
          createdByUserId
        })));
        const bodyParameters = templateParameters(template, {
          recipient,
          student,
          session: roster.session,
          statusLabel: labels[normalizeAttendanceStatus(rosterStudent.status)] || normalizeAttendanceStatus(rosterStudent.status),
          responseStatusLabels: statuses.map((status) => labels[status])
        }, effectiveMappings);
        const expectedBodyParameterCount = templateBodyParameterCount(template);
        if (bodyParameters.length !== expectedBodyParameterCount) {
          throw new Error(`מספר משתני התבנית אינו תואם להגדרה המאושרת (${bodyParameters.length}/${expectedBodyParameterCount}).`);
        }
        console.info("Attendance WhatsApp template payload prepared", {
          sessionId,
          templateName: template.name,
          bodyParameterCount: bodyParameters.length,
          quickReplyCount: responsePayloads.length,
          hasHeaderMedia: requiresMedia,
          headerMediaType,
          hasHeaderMediaId: Boolean(clean(imageId))
        });
        await sendTemplate({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: recipient.value,
          type: "template",
          template: {
            name: template.name,
            language: { code: templateLanguage || template.language || "he" },
            components: [
            ...(requiresMedia ? [{
              type: "header",
              parameters: [{
                type: headerMediaType,
                [headerMediaType]: { id: clean(imageId) }
              }]
            }] : []),
            ...(expectedBodyParameterCount > 0 ? [{
              type: "body",
              parameters: templateBodyParameters(template, bodyParameters)
            }] : []),
            ...responsePayloads.map((payload, index) => ({
              type: "button",
              sub_type: "quick_reply",
              index: String(quickReplyButtons[index]?.index ?? index),
              parameters: [{ type: "payload", payload }]
            }))
            ]
          }
        });
        sentMessages += 1;
      } catch (error) {
        failedMessages += 1;
        const message = clean(error?.message) || "שגיאה לא ידועה בשליחת WhatsApp.";
        if (errors.length < 3 && !errors.includes(message)) errors.push(message);
        console.error("Attendance approved WhatsApp template failed", {
          sessionId,
          studentId: rosterStudent.id,
          recipientRole: recipient.role,
          templateName: template.name,
          parameterFormat: template.parameterFormat,
          bodyParameterCount: template.bodyParameterCount ?? template.parameterCount,
          quickReplyCount: quickReplyButtons.length,
          error: message
        });
      }
    }
  }
  return { sentMessages, failedMessages, missingRecipients, matchedStudents: students.length, errors };
}

function componentType(component) {
  return clean(component?.type || component?.componentType).toLowerCase();
}

function componentText(component) {
  const direct = component?.text || component?.bodyText || component?.body_text;
  return clean(direct);
}

function normalizedHeaderFormat(row, header) {
  const candidates = [
    header?.format,
    header?.format_type,
    header?.headerFormat,
    header?.header_format,
    header?.type,
    header?.type === "HEADER" ? header?.mediaType : "",
    header?.type === "HEADER" ? header?.media_type : "",
    header?.type === "HEADER" ? header?.format?.type : "",
    header?.type === "HEADER" ? header?.format?.format : "",
    row?.headerFormat,
    row?.header_format,
    row?.headerType,
    row?.template?.headerFormat,
    row?.template?.header_format,
    row?.template?.headerType
  ];
  const direct = candidates.map((value) => clean(value).toUpperCase()).find((value) => ["TEXT", "IMAGE", "VIDEO", "DOCUMENT"].includes(value));
  if (direct) return direct;
  const name = clean(row?.name).toLowerCase();
  if (name.includes("image")) return "IMAGE";
  if (name.includes("document") || name.includes("pdf")) return "DOCUMENT";
  return "";
}

function templateComponents(row) {
  if (Array.isArray(row?.components)) return row.components;
  if (Array.isArray(row?.template?.components)) return row.template.components;
  return [];
}

function explicitBodyParameterCount(row, body) {
  const candidates = [
    row?.bodyParameterCount,
    row?.body_parameter_count,
    body?.parametersCount,
    body?.parameters_count,
    body?.parameterCount,
    body?.parameter_count
  ];
  const count = candidates.map(Number).find((value) => Number.isFinite(value) && value >= 0);
  return count == null ? null : Math.floor(count);
}

function explicitTemplateParameterCount(row) {
  const candidates = [row?.parameterCount, row?.parameter_count, row?.template?.parameterCount, row?.template?.parameter_count];
  const count = candidates.map(Number).find((value) => Number.isFinite(value) && value >= 0);
  return count == null ? null : Math.floor(count);
}

function normalizeParameterFormat(value) {
  const format = clean(value).toLowerCase();
  if (format === "named") return "named";
  if (["positional", "numeric", "numbered"].includes(format)) return "positional";
  return "";
}

function explicitParameterFormat(row, body) {
  const candidates = [
    row?.parameterFormat,
    row?.parameter_format,
    row?.template?.parameterFormat,
    row?.template?.parameter_format,
    body?.parameterFormat,
    body?.parameter_format
  ];
  return candidates.map(normalizeParameterFormat).find(Boolean) || "";
}

function namedParameterNames(row, body) {
  const candidates = [
    body?.example?.body_text_named_params,
    body?.example?.bodyTextNamedParams,
    body?.body_text_named_params,
    body?.bodyTextNamedParams,
    row?.example?.body_text_named_params,
    row?.example?.bodyTextNamedParams,
    row?.body_text_named_params,
    row?.bodyTextNamedParams,
    row?.template?.example?.body_text_named_params,
    row?.template?.example?.bodyTextNamedParams
  ];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    const names = candidate.map((item) => clean(item?.param_name || item?.parameter_name || item?.name));
    if (names.some(Boolean)) return names.filter(Boolean);
  }
  return [];
}

function exampleBodyParameterCount(body) {
  if (Array.isArray(body?.parameters) && body.parameters.length) return body.parameters.length;
  const examples = [
    body?.example?.body_text,
    body?.example?.bodyText,
    body?.example?.body_text_examples,
    body?.example?.bodyTextExamples
  ];
  for (const example of examples) {
    if (!Array.isArray(example)) continue;
    const values = Array.isArray(example[0]) ? example[0] : example;
    if (values.length && values.every((value) => typeof value === "string" || typeof value === "number")) {
      return values.length;
    }
  }
  return 0;
}

function bodyParameterTokens(bodyText) {
  return Array.from(bodyText.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g))
    .map((match) => clean(match[1]))
    .filter(Boolean);
}

function templateBodyParameterCount(template) {
  const bodyText = clean(template?.bodyText || template?.body_text);
  if (bodyText) {
    const tokens = bodyParameterTokens(bodyText);
    const numericIndexes = tokens
      .map((token) => Number(token))
      .filter((value) => Number.isInteger(value) && value > 0);
    if (numericIndexes.length) return Math.max(...numericIndexes);
    return new Set(tokens).size;
  }
  const explicitCount = Math.max(0, Number(template?.bodyParameterCount ?? template?.parameterCount) || 0);
  // Dualhook can omit the body definition for an approved template while
  // Meta still enforces the parameter count. Our invitation templates all
  // use the stable recipient/session/free-text contract (three values).
  return explicitCount || (isInvitationTemplateName(template?.name) ? 3 : 0);
}

export function normalizeCoexistenceTemplate(row) {
  const components = templateComponents(row);
  const body = components.find((component) => componentType(component) === "body") || row?.body || row?.template?.body;
  const header = components.find((component) => componentType(component) === "header") || row?.header || row?.template?.header;
  const footer = components.find((component) => componentType(component) === "footer") || row?.footer || row?.template?.footer;
  const buttonsComponent = components.find((component) => componentType(component) === "buttons");
  const buttons = Array.isArray(buttonsComponent?.buttons)
    ? buttonsComponent.buttons
    : Array.isArray(buttonsComponent)
      ? buttonsComponent
    : (Array.isArray(row?.buttons) ? row.buttons : []);
  const bodyText = componentText(body) || clean(row?.bodyText || row?.body_text || row?.template?.bodyText || row?.template?.body_text);
  const tokens = bodyParameterTokens(bodyText);
  const exampleParameterNames = namedParameterNames(row, body);
  const tokenParameterNames = tokens.filter((token) => !/^\d+$/.test(token));
  const namedNames = Array.from(new Set([...tokenParameterNames, ...exampleParameterNames]));
  const parameterFormat = explicitParameterFormat(row, body) || (namedNames.length ? "named" : "positional");
  const numericIndexes = tokens.map((token) => Number(token)).filter((value) => Number.isInteger(value) && value > 0);
  const inferredCount = numericIndexes.length
    ? Math.max(...numericIndexes)
    : parameterFormat === "named"
      ? namedNames.length
      : new Set(tokens).size;
  const bodyExplicitCount = explicitBodyParameterCount(row, body);
  const exampleCount = exampleBodyParameterCount(body);
  // When the provider includes the body text, its placeholders are the
  // source of truth. Provider-level parameterCount fields can describe the
  // whole template or be stale after a template revision, which causes Meta
  // error #132000 if used for the body component.
  const hasBodyText = Boolean(bodyText);
  const providerParameterCount = hasBodyText
    ? inferredCount
    : Math.max(
      inferredCount,
      bodyExplicitCount ?? 0,
      exampleCount,
      explicitTemplateParameterCount(row) ?? 0
    );
  // The provider occasionally returns approved invitation metadata without
  // its body component. Keep the CRM contract aligned with Meta's approved
  // template: recipient, session details, and free text.
  const parameterCount = providerParameterCount || (isInvitationTemplateName(row?.name) ? 3 : 0);
  const language = typeof row?.language === "object" ? row.language?.code : row?.language;
  const buttonCount = buttons.filter((button) => ["QUICK_REPLY", "QUICK_REPLY_BUTTON"].includes(clean(button?.type || button?.subType).toUpperCase())).length;
  const normalizedButtons = buttons.map((button, sourceIndex) => {
    const type = clean(button?.type || button?.subType).toUpperCase();
    const isQuickReply = ["QUICK_REPLY", "QUICK_REPLY_BUTTON"].includes(type);
    const explicitIndex = Number(button?.index);
    const index = isQuickReply
      ? (Number.isInteger(explicitIndex) && explicitIndex >= 0 ? explicitIndex : sourceIndex)
      : null;
    return {
      type,
      text: clean(button?.text || button?.label),
      ...(index == null ? {} : { index })
    };
  });
  const name = clean(row?.name);
  // The order here is the numeric placeholder order in the approved Meta
  // template, not the visual order in which placeholders happen to appear.
  // In particular, the parent attendance template uses {{4}} for the student
  // name while {{2}} and {{3}} appear earlier in the body text.
  const sourceSequence = isInvitationTemplateName(name)
    ? ["recipient", "session", "free"]
    : name === PARENT_TEMPLATE_NAME
      ? ["recipient", "session", "free", "student", ...(buttonCount ? ["responseStatus:1", "responseStatus:2"] : [])]
      : name.startsWith("parent_meeting") || name === TEMPLATE_NAME
        ? ["recipient", "session", "free", ...(buttonCount ? ["responseStatus:1", "responseStatus:2"] : [])]
        : ["recipient", "free", ...(buttonCount ? ["responseStatus:1", "responseStatus:2"] : [])];
  const parameterDefinitions = Array.from({ length: parameterCount }, (_, offset) => ({
    index: offset + 1,
    ...(parameterFormat === "named" ? { parameterName: namedNames[offset] || "" } : {}),
    source: sourceSequence[offset] || "free",
    label: sourceSequence[offset] === "free" ? `טקסט אישי ${offset + 1}` : sourceSequence[offset] || `שדה ${offset + 1}`,
    editable: sourceSequence[offset] === "free"
  }));
  const headerFormat = normalizedHeaderFormat(row, header);
  return {
    name,
    language: clean(language || row?.language_code) || "he",
    status: clean(row?.status).toUpperCase(),
    category: clean(row?.category),
    bodyText,
    parameterCount,
    bodyParameterCount: parameterCount,
    parameterFormat,
    components,
    headerFormat,
    requiresImage: headerFormat === "IMAGE",
    requiresMedia: ["IMAGE", "DOCUMENT"].includes(headerFormat),
    footerText: componentText(footer),
    buttons: normalizedButtons,
    buttonLabels: normalizedButtons.filter((button) => button.type === "QUICK_REPLY" || button.type === "QUICK_REPLY_BUTTON").map((button) => button.text).filter(Boolean),
    parameterDefinitions
  };
}

export async function listWhatsAppCoexistenceApprovedTemplates() {
  const config = coexistenceWhatsAppConfig();
  const response = await fetch(config.templatesUrl, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.accessToken}`
    },
    cache: "no-store"
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(clean(data?.error?.message) || "טעינת תבניות WhatsApp של בוט התפוצה נכשלה.");
  const rows = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.templates)
      ? data.templates
      : Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data?.results)
          ? data.results
          : Array.isArray(data)
            ? data
            : [];
  return rows.map(normalizeCoexistenceTemplate)
    .filter((template) => template.name && ["APPROVED", "ACTIVE", "ENABLED"].includes(template.status))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function applyAttendanceWhatsAppResponse(
  payload,
  senderPhone = "",
  responseText = "",
  occurredAt = "",
) {
  const tokenId = clean(payload).replace(/^attendance:/, "");
  if (!tokenId || tokenId === clean(payload)) return null;
  await ensureTokenTable();
  const rows = await sql`
    SELECT id, session_id, student_id, recipient_phone, status, created_by_user_id, used_at
    FROM attendance_whatsapp_response_tokens
    WHERE id = ${tokenId}
    LIMIT 1
  `;
  const token = rows[0];
  if (!token || token.used_at) return null;
  if (normalizePhone(senderPhone) !== normalizePhone(token.recipient_phone)) return null;
  const student = await getNeonStudentById(token.student_id);
  const existingRows = await sql`
    SELECT note_text
    FROM attendance_records
    WHERE session_id = ${clean(token.session_id)} AND student_id = ${clean(token.student_id)}
    LIMIT 1
  `;
  await saveAttendanceRecord({
    sessionId: token.session_id,
    record: {
      studentId: token.student_id,
      studentName: clean(student?.label) || clean(token.student_id),
      studentClass: clean(student?.class),
      status: token.status,
      noteText: clean(existingRows?.[0]?.note_text)
    },
    markedByUserId: clean(token.created_by_user_id) || null
  });
  await saveFirstAttendanceResponse({
    sessionId: token.session_id,
    studentId: token.student_id,
    responseText: clean(responseText) || normalizeAttendanceStatus(token.status),
    occurredAt: occurredAt || new Date()
  });
  await sql`UPDATE attendance_whatsapp_response_tokens SET used_at = NOW() WHERE id = ${tokenId} AND used_at IS NULL`;
  return { sessionId: clean(token.session_id), studentId: clean(token.student_id), status: normalizeAttendanceStatus(token.status) };
}

function responseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return new Date(numeric > 1_000_000_000_000 ? numeric : numeric * 1000);
  }
  const parsed = new Date(String(value || ""));
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

async function saveFirstAttendanceResponse({ sessionId, studentId, responseText, occurredAt }) {
  const normalizedSessionId = clean(sessionId);
  const normalizedStudentId = clean(studentId);
  const text = clean(responseText);
  if (!normalizedSessionId || !normalizedStudentId || !text) return false;
  const rows = await sql`
    UPDATE attendance_records
    SET
      first_response_text = COALESCE(NULLIF(BTRIM(first_response_text), ''), ${text}),
      first_response_at = COALESCE(first_response_at, ${responseDate(occurredAt)}),
      first_response_channel = COALESCE(NULLIF(BTRIM(first_response_channel), ''), 'whatsapp'),
      updated_at = NOW()
    WHERE session_id = ${normalizedSessionId} AND student_id = ${normalizedStudentId}
    RETURNING first_response_text
  `;
  return Boolean(rows?.length);
}

async function ensureAttendanceResponseRecord({ sessionId, studentId }) {
  const normalizedSessionId = clean(sessionId);
  const normalizedStudentId = clean(studentId);
  const rows = await sql`
    SELECT 1
    FROM attendance_records
    WHERE session_id = ${normalizedSessionId} AND student_id = ${normalizedStudentId}
    LIMIT 1
  `;
  if (rows.length) return true;
  const student = await getNeonStudentById(normalizedStudentId);
  if (!student) return false;
  await saveAttendanceRecord({
    sessionId: normalizedSessionId,
    record: {
      studentId: normalizedStudentId,
      studentName: clean(student.label) || normalizedStudentId,
      studentClass: clean(student.class),
      status: 'missing',
      noteText: ''
    },
    markedByUserId: null
  });
  return true;
}

export async function recordAttendanceWhatsAppTextResponse(senderPhone = "", responseText = "", occurredAt = "") {
  const normalizedPhone = normalizePhone(senderPhone);
  const text = clean(responseText);
  if (!normalizedPhone || !text) return null;
  await ensureTokenTable();
  const rows = await sql`
    SELECT id, session_id, student_id
    FROM attendance_whatsapp_response_tokens
    WHERE recipient_phone = ${normalizedPhone}
      AND used_at IS NULL
      AND created_at >= NOW() - INTERVAL '30 days'
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const token = rows[0];
  if (!token) return null;
  try {
    if (!(await ensureAttendanceResponseRecord(token))) return null;
  } catch (error) {
    console.error("Unable to ensure attendance record for WhatsApp response:", error?.message || error);
    return null;
  }
  const saved = await saveFirstAttendanceResponse({
    sessionId: token.session_id,
    studentId: token.student_id,
    responseText: text,
    occurredAt
  });
  if (saved) {
    await sql`
      UPDATE attendance_whatsapp_response_tokens
      SET used_at = NOW()
      WHERE id = ${token.id} AND used_at IS NULL
    `;
  }
  return saved ? { sessionId: clean(token.session_id), studentId: clean(token.student_id) } : null;
}
