import { randomUUID } from "node:crypto";
import { initDb, sql } from "./db";
import {
  buildAttendanceStatusLabels,
  getAttendanceRoster,
  normalizeAttendanceStatus,
  saveAttendanceRecord
} from "./attendance";
import { getNeonStudentById } from "./neon-students";
import { sendWhatsAppTemplateMessage } from "./whatsapp";

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
  const token = clean(process.env.WHATSAPP_COEX_ACCESS_TOKEN);
  const phoneNumberId = clean(process.env.WHATSAPP_COEX_PHONE_NUMBER_ID);
  const base = clean(process.env.WHATSAPP_COEX_API_BASE || "https://api.dualhook.com").replace(/\/+$/, "");
  if (!token || !phoneNumberId) throw new Error("חיבור WhatsApp האנושי אינו מוגדר.");
  const response = await fetch(`${base}/v25.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(clean(data?.error?.message) || `WhatsApp send failed (${response.status})`);
  return data;
}

export async function uploadAttendanceWhatsAppImage(file) {
  if (!file || typeof file.arrayBuffer !== "function" || !file.size) return "";
  const token = clean(process.env.WHATSAPP_COEX_ACCESS_TOKEN);
  const phoneNumberId = clean(process.env.WHATSAPP_COEX_PHONE_NUMBER_ID);
  const base = clean(process.env.WHATSAPP_COEX_API_BASE || "https://api.dualhook.com").replace(/\/+$/, "");
  const mimeType = clean(file.type).toLowerCase();
  if (!token || !phoneNumberId) throw new Error("חיבור WhatsApp האנושי אינו מוגדר.");
  if (!["image/jpeg", "image/png"].includes(mimeType)) throw new Error("אפשר לצרף תמונת JPG או PNG בלבד.");
  if (file.size > 5 * 1024 * 1024) throw new Error("גודל התמונה המרבי הוא 5MB.");
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", file, clean(file.name) || "attendance-image");
  const response = await fetch(`${base}/v25.0/${phoneNumberId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !clean(data?.id)) throw new Error(clean(data?.error?.message) || "העלאת התמונה ל-WhatsApp נכשלה.");
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

function templateParameters(template, student, session, statusLabel) {
  const values = [
    clean(student?.label) || "תלמיד",
    clean(student?.class),
    clean(session?.displayTitle || session?.title || session?.sessionTypeLabel),
    clean(session?.sessionDate),
    clean(statusLabel),
    clean(session?.institutionLabel)
  ];
  const count = Math.max(0, Number(template?.parameterCount) || 0);
  return values.slice(0, count);
}

export async function sendAttendanceSessionWhatsAppApprovedTemplate({
  sessionId,
  templateName,
  templateLanguage = "he",
  recipientRoles = ["student"],
  targetStatuses = [],
  templates = []
}) {
  const roster = await getAttendanceRoster(sessionId);
  if (!roster) throw new Error("המפגש לא נמצא.");
  const template = (Array.isArray(templates) ? templates : [])
    .find((item) => clean(item?.name) === clean(templateName));
  if (!template) throw new Error("יש לבחור תבנית WhatsApp מאושרת.");
  const allowedStatuses = new Set(unique(targetStatuses).map(normalizeAttendanceStatus));
  const students = roster.students.filter((student) => !allowedStatuses.size || allowedStatuses.has(normalizeAttendanceStatus(student.status)));
  if (!students.length) throw new Error("לא נמצאו תלמידים מתאימים לשליחה.");
  const labels = buildAttendanceStatusLabels(roster.session.customStatuses);
  let sentMessages = 0;
  let failedMessages = 0;
  let missingRecipients = 0;
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
        await sendWhatsAppTemplateMessage(recipient.value, {
          name: template.name,
          language: templateLanguage || template.language || "he",
          bodyParameters: templateParameters(
            template,
            student,
            roster.session,
            labels[normalizeAttendanceStatus(rosterStudent.status)] || normalizeAttendanceStatus(rosterStudent.status)
          )
        });
        sentMessages += 1;
      } catch (error) {
        failedMessages += 1;
        console.error("Attendance approved WhatsApp template failed", {
          sessionId,
          studentId: rosterStudent.id,
          recipientRole: recipient.role,
          error: clean(error?.message)
        });
      }
    }
  }
  return { sentMessages, failedMessages, missingRecipients, matchedStudents: students.length };
}

export async function applyAttendanceWhatsAppResponse(payload, senderPhone = "") {
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
  await saveAttendanceRecord({
    sessionId: token.session_id,
    record: {
      studentId: token.student_id,
      studentName: clean(student?.label) || clean(token.student_id),
      studentClass: clean(student?.class),
      status: token.status,
      noteText: "עודכן דרך WhatsApp"
    },
    markedByUserId: clean(token.created_by_user_id) || null
  });
  await sql`UPDATE attendance_whatsapp_response_tokens SET used_at = NOW() WHERE id = ${tokenId} AND used_at IS NULL`;
  return { sessionId: clean(token.session_id), studentId: clean(token.student_id), status: normalizeAttendanceStatus(token.status) };
}
