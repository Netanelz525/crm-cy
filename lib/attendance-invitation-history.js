import { randomUUID } from "node:crypto";
import { initDb, sql } from "./db";

function clean(value) { return String(value || "").trim(); }

export async function recordAttendanceInvitationSend({ sessionId, channel, templateName = "", sentCount = 0, failedCount = 0, missingCount = 0 }) {
  await initDb();
  if (!clean(sessionId) || !["email", "whatsapp"].includes(clean(channel))) return null;
  const rows = await sql`
    INSERT INTO attendance_invitation_sends (id, session_id, channel, template_name, sent_count, failed_count, missing_count)
    VALUES (${randomUUID()}, ${clean(sessionId)}, ${clean(channel)}, ${clean(templateName) || null}, ${Number(sentCount) || 0}, ${Number(failedCount) || 0}, ${Number(missingCount) || 0})
    RETURNING id, channel, template_name, sent_count, failed_count, missing_count, created_at
  `;
  return rows[0] || null;
}

export async function listAttendanceInvitationSends(sessionId, limit = 30) {
  await initDb();
  const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const rows = await sql`
    SELECT id, channel, template_name, sent_count, failed_count, missing_count, created_at
    FROM attendance_invitation_sends
    WHERE session_id = ${clean(sessionId)}
    ORDER BY created_at DESC
    LIMIT ${safeLimit}
  `;
  return rows.map((row) => ({
    id: clean(row.id), channel: clean(row.channel), templateName: clean(row.template_name),
    sentCount: Number(row.sent_count) || 0, failedCount: Number(row.failed_count) || 0,
    missingCount: Number(row.missing_count) || 0, createdAt: row.created_at
  }));
}
