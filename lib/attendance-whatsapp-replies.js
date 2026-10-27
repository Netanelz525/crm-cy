import { randomUUID } from "node:crypto";
import { ensureDbFeature, sql } from "./db";

let ready;
async function ensureTables() {
  if (!ready) ready = ensureDbFeature("attendance-whatsapp-replies","20261027_1",async () => {
    await sql`CREATE TABLE IF NOT EXISTS attendance_whatsapp_messages (
      message_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL,
      recipient_phone TEXT NOT NULL,
      template_name TEXT,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_attendance_wa_messages_phone ON attendance_whatsapp_messages (recipient_phone, sent_at DESC)`;
    await sql`CREATE TABLE IF NOT EXISTS attendance_whatsapp_replies (
      message_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL,
      sender_phone TEXT NOT NULL,
      source_message_id TEXT,
      response_text TEXT NOT NULL,
      response_status TEXT,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_attendance_wa_replies_session ON attendance_whatsapp_replies (session_id, student_id, received_at DESC)`;
  });
  try { await ready; } catch (error) { ready = null; throw error; }
}

export async function linkAttendanceWhatsAppMessage({ messageId, sessionId, studentId, phone, templateName, sentAt = new Date() }) {
  if (!messageId) throw new Error("WhatsApp לא החזיר מזהה הודעה לשיוך למפגש.");
  await ensureTables();
  await sql`INSERT INTO attendance_whatsapp_messages (message_id, session_id, student_id, recipient_phone, template_name, sent_at)
    VALUES (${messageId}, ${sessionId}, ${studentId}, ${phone}, ${templateName || ""}, ${sentAt}) ON CONFLICT (message_id) DO NOTHING`;
}

export function attendanceReplyDate(value) {
  const numeric = Number(value);
  const date = value instanceof Date ? value : Number.isFinite(numeric) && numeric > 0
    ? new Date(numeric > 1e12 ? numeric : numeric * 1000) : new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export function isAttendanceTextReplyWithinWindow(sentAt, receivedAt) {
  const sent = new Date(sentAt).getTime();
  const received = attendanceReplyDate(receivedAt).getTime();
  return Number.isFinite(sent) && Math.floor(received / 1000) >= Math.floor(sent / 1000)
    && received - sent <= 5 * 60 * 60 * 1000;
}

export async function resolveAttendanceWhatsAppText(phone, contextMessageId = "", occurredAt = "") {
  await ensureTables();
  const receivedAt = attendanceReplyDate(occurredAt);
  // Never fall back to a different meeting when a quoted message is unknown.
  // Both quoted and unquoted free-text replies have the same five-hour window.
  const rows = await sql`SELECT m.message_id, m.session_id, m.student_id, m.sent_at, s.is_locked
    FROM attendance_whatsapp_messages m JOIN attendance_sessions s ON s.id = m.session_id
    WHERE m.recipient_phone = ${phone}
      AND (${contextMessageId} = '' OR m.message_id = ${contextMessageId})
      AND date_trunc('second', m.sent_at) <= ${receivedAt}
    ORDER BY m.sent_at DESC, m.message_id DESC LIMIT 1`;
  const message = rows[0];
  if (!message) return null;
  // Check AFTER selecting the last message: an expired latest message must not
  // make an older, unrelated meeting become the fallback.
  return isAttendanceTextReplyWithinWindow(message.sent_at, receivedAt) ? message : null;
}

export async function saveAttendanceWhatsAppReply({ messageId, sessionId, studentId, phone, sourceMessageId = "", text, status = "", occurredAt = "" }) {
  await ensureTables();
  await sql`INSERT INTO attendance_whatsapp_replies (message_id, session_id, student_id, sender_phone, source_message_id, response_text, response_status, received_at)
    VALUES (${messageId || randomUUID()}, ${sessionId}, ${studentId}, ${phone}, ${sourceMessageId || null}, ${text}, ${status || null}, ${attendanceReplyDate(occurredAt)})
    ON CONFLICT (message_id) DO NOTHING`;
}

export async function listAttendanceWhatsAppReplies(sessionId) {
  await ensureTables();
  const rows = await sql`SELECT student_id, response_text, response_status, received_at FROM (
    SELECT student_id, response_text, response_status, received_at,
      ROW_NUMBER() OVER (PARTITION BY student_id ORDER BY received_at DESC, message_id DESC) AS position
    FROM attendance_whatsapp_replies WHERE session_id = ${sessionId}
  ) recent WHERE position <= 10 ORDER BY received_at DESC`;
  return rows;
}

export async function withAttendanceWhatsAppReplies(roster) {
  if (!roster) return null;
  const replies = await listAttendanceWhatsAppReplies(roster.session.id);
  const grouped = new Map();
  for (const reply of replies) {
    if (!grouped.has(reply.student_id)) grouped.set(reply.student_id, []);
    grouped.get(reply.student_id).push(reply);
  }
  return { ...roster, students: roster.students.map((student) => ({ ...student, whatsappReplies: grouped.get(student.id) || [] })) };
}
