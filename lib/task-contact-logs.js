import { randomUUID } from "node:crypto";
import { initDb, sql } from "./db";

function clean(value) {
  return String(value || "").trim();
}

function normalizeDate(value) {
  const raw = clean(value);
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function mapTaskContactLog(row) {
  return {
    id: clean(row?.id),
    taskId: clean(row?.task_id),
    contactDate: clean(row?.contact_date),
    noteText: clean(row?.note_text),
    reminderDate: clean(row?.reminder_date),
    reminderSentAt: row?.reminder_sent_at || null,
    createdByUserId: clean(row?.created_by_user_id),
    createdByDisplayName: clean(row?.created_by_display_name),
    createdByEmail: clean(row?.created_by_email),
    createdAt: row?.created_at || null
  };
}

export async function createTaskContactLog({ taskId, contactDate, noteText, reminderDate = "", createdByUserId = "" }) {
  await initDb();
  const normalizedTaskId = clean(taskId);
  const normalizedContactDate = normalizeDate(contactDate);
  const normalizedReminderDate = normalizeDate(reminderDate);
  const normalizedNoteText = clean(noteText);

  if (!normalizedTaskId) throw new Error("לא נבחרה משימה.");
  if (!normalizedContactDate) throw new Error("יש לבחור תאריך יצירת קשר.");
  if (!normalizedNoteText) throw new Error("יש להזין תיעוד פעולה.");

  const id = randomUUID();
  const rows = await sql`
    INSERT INTO crm_task_contact_logs (
      id,
      task_id,
      contact_date,
      note_text,
      reminder_date,
      created_by_user_id,
      created_at
    )
    VALUES (
      ${id},
      ${normalizedTaskId},
      ${normalizedContactDate},
      ${normalizedNoteText},
      ${normalizedReminderDate || null},
      ${clean(createdByUserId) || null},
      NOW()
    )
    RETURNING id, task_id, contact_date, note_text, reminder_date, reminder_sent_at, created_by_user_id, created_at
  `;
  return mapTaskContactLog(rows[0]);
}

export async function listTaskContactLogs(taskId, limit = 12) {
  await initDb();
  const normalizedTaskId = clean(taskId);
  if (!normalizedTaskId) return [];
  const rows = await sql`
    SELECT
      l.id,
      l.task_id,
      l.contact_date,
      l.note_text,
      l.reminder_date,
      l.reminder_sent_at,
      l.created_by_user_id,
      l.created_at,
      u.display_name AS created_by_display_name,
      u.email AS created_by_email
    FROM crm_task_contact_logs l
    LEFT JOIN app_users u ON u.clerk_user_id = l.created_by_user_id
    WHERE l.task_id = ${normalizedTaskId}
    ORDER BY l.contact_date DESC, l.created_at DESC
    LIMIT ${Math.max(1, Number(limit) || 12)}
  `;
  return rows.map(mapTaskContactLog);
}

export async function listTaskContactLogsByTaskIds(taskIds, perTaskLimit = 10) {
  await initDb();
  const ids = [...new Set((taskIds || []).map(clean).filter(Boolean))];
  if (!ids.length) return {};
  const limit = Math.max(1, Number(perTaskLimit) || 10);
  const rows = await sql`
    SELECT *
    FROM (
      SELECT
        l.id,
        l.task_id,
        l.contact_date,
        l.note_text,
        l.reminder_date,
        l.reminder_sent_at,
        l.created_by_user_id,
        l.created_at,
        u.display_name AS created_by_display_name,
        u.email AS created_by_email,
        ROW_NUMBER() OVER (
          PARTITION BY l.task_id
          ORDER BY l.contact_date DESC, l.created_at DESC
        ) AS row_number
      FROM crm_task_contact_logs l
      LEFT JOIN app_users u ON u.clerk_user_id = l.created_by_user_id
      WHERE l.task_id = ANY(${ids})
    ) ranked
    WHERE ranked.row_number <= ${limit}
    ORDER BY ranked.task_id, ranked.contact_date DESC, ranked.created_at DESC
  `;
  const grouped = {};
  for (const row of rows) {
    const taskId = clean(row.task_id);
    if (!grouped[taskId]) grouped[taskId] = [];
    grouped[taskId].push(mapTaskContactLog(row));
  }
  return grouped;
}

export async function listTaskReminderLogsForDate(reminderDate) {
  await initDb();
  const normalizedReminderDate = normalizeDate(reminderDate);
  if (!normalizedReminderDate) return [];
  const rows = await sql`
    SELECT
      l.id,
      l.task_id,
      l.contact_date,
      l.note_text,
      l.reminder_date,
      l.reminder_sent_at,
      l.created_by_user_id,
      l.created_at,
      u.display_name AS created_by_display_name,
      u.email AS created_by_email
    FROM crm_task_contact_logs l
    LEFT JOIN app_users u ON u.clerk_user_id = l.created_by_user_id
    JOIN crm_tasks t ON t.id = l.task_id
    WHERE l.reminder_date = ${normalizedReminderDate}
      AND l.reminder_sent_at IS NULL
      AND t.status <> 'done'
    ORDER BY l.reminder_date ASC, l.created_at ASC
  `;
  return rows.map(mapTaskContactLog);
}

export async function markTaskReminderSent(logId) {
  await initDb();
  await sql`
    UPDATE crm_task_contact_logs
    SET reminder_sent_at = NOW()
    WHERE id = ${clean(logId)}
  `;
}
