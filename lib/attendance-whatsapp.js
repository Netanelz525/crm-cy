import { randomUUID } from "node:crypto";
import { initDb, sql } from "./db";
import {
  buildAttendanceStatusLabels,
  getAttendanceRoster,
  normalizeAttendanceStatus,
  saveAttendanceRecord
} from "./attendance";
import { getNeonStudentById } from "./neon-students";

const TEMPLATE_NAME = "attendance_status_update_v1";
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
    student: { value: phoneValue(student?.phone || student?.studentPhone), label: clean(student?.label), role: "student" },
    father: { value: phoneValue(student?.dadPhone || student?.fatherPhone), label: clean(student?.fatherName), role: "father" },
    mother: { value: phoneValue(student?.momPhone || student?.motherPhone), label: clean(student?.motherName), role: "mother" }
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

export async function sendAttendanceSessionWhatsApp({
  sessionId,
  personalMessage = "",
  responseStatuses = [],
  targetStatuses = [],
  recipientRoles = [],
  testPhone = "",
  testStudentId = "",
  imageUrl = "",
  createdByUserId = ""
}) {
  const roster = await getAttendanceRoster(sessionId);
  if (!roster) throw new Error("המפגש לא נמצא.");
  const labels = buildAttendanceStatusLabels(roster.session.customStatuses);
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
    const recipients = clean(testPhone)
      ? [{ value: normalizePhone(testPhone), label: "בדיקה", role: "test" }]
      : recipientPhones(student, recipientRoles);
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
      const components = [{
        type: "body",
        parameters: [
          { type: "text", text: clean(recipient.label) || "שלום" },
          { type: "text", text: clean(roster.session.title) || "המפגש" },
          { type: "text", text: clean(personalMessage) || "נשמח לעדכון הסטטוס." },
          { type: "text", text: clean(student.label) || clean(rosterStudent.label) || "התלמיד" },
          { type: "text", text: labels[statuses[0]] },
          { type: "text", text: labels[statuses[1]] }
        ]
      }];
      if (clean(imageUrl)) components.unshift({ type: "header", parameters: [{ type: "image", image: { link: clean(imageUrl) } }] });
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
          template: { name: TEMPLATE_NAME, language: { code: TEMPLATE_LANGUAGE }, components }
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

