import { randomUUID } from "crypto";
import { initDb, sql } from "./db";

function clean(value) {
  return String(value || "").trim();
}

function normalizeDate(value) {
  const raw = clean(value);
  if (!raw) return "";
  const match = raw.match(/^\d{4}-\d{2}-\d{2}$/);
  if (match) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function mapContactRow(row) {
  return {
    id: clean(row?.id),
    studentId: clean(row?.student_id),
    contactDate: clean(row?.contact_date),
    noteText: clean(row?.note_text),
    createdAt: row?.created_at || null,
    createdByUserId: clean(row?.created_by_user_id),
    createdByDisplayName: clean(row?.created_by_display_name),
    createdByEmail: clean(row?.created_by_email)
  };
}

export async function createStudentContactLog({ studentId, contactDate, noteText, createdByUserId }) {
  await initDb();
  const normalizedStudentId = clean(studentId);
  const normalizedDate = normalizeDate(contactDate);
  const normalizedNoteText = clean(noteText);

  if (!normalizedStudentId) throw new Error("לא נבחר תלמיד.");
  if (!normalizedDate) throw new Error("יש לבחור תאריך יצירת קשר.");
  if (!normalizedNoteText) throw new Error("יש להזין תיעוד קצר.");

  const id = randomUUID();
  const rows = await sql`
    INSERT INTO student_contact_logs (
      id,
      student_id,
      contact_date,
      note_text,
      created_by_user_id,
      created_at
    )
    VALUES (
      ${id},
      ${normalizedStudentId},
      ${normalizedDate},
      ${normalizedNoteText},
      ${clean(createdByUserId) || null},
      NOW()
    )
    RETURNING id, student_id, contact_date, note_text, created_by_user_id, created_at
  `;
  return mapContactRow(rows[0]);
}

export async function listStudentContactLogs(studentId, limit = 8) {
  await initDb();
  const normalizedStudentId = clean(studentId);
  if (!normalizedStudentId) return [];
  const rows = await sql`
    SELECT
      l.id,
      l.student_id,
      l.contact_date,
      l.note_text,
      l.created_by_user_id,
      l.created_at,
      u.display_name AS created_by_display_name,
      u.email AS created_by_email
    FROM student_contact_logs l
    LEFT JOIN app_users u ON u.clerk_user_id = l.created_by_user_id
    WHERE l.student_id = ${normalizedStudentId}
    ORDER BY l.contact_date DESC, l.created_at DESC
    LIMIT ${Math.max(1, Number(limit) || 8)}
  `;
  return rows.map(mapContactRow);
}

export async function getLatestContactLogsByStudentIds(studentIds) {
  await initDb();
  const ids = (studentIds || []).map(clean).filter(Boolean);
  if (!ids.length) return {};
  const rows = await sql`
    SELECT DISTINCT ON (l.student_id)
      l.id,
      l.student_id,
      l.contact_date,
      l.note_text,
      l.created_by_user_id,
      l.created_at,
      u.display_name AS created_by_display_name,
      u.email AS created_by_email
    FROM student_contact_logs l
    LEFT JOIN app_users u ON u.clerk_user_id = l.created_by_user_id
    WHERE l.student_id = ANY(${ids})
    ORDER BY l.student_id, l.contact_date DESC, l.created_at DESC
  `;
  const map = {};
  for (const row of rows) {
    map[clean(row.student_id)] = mapContactRow(row);
  }
  return map;
}

export async function attachLatestContactToStudents(students) {
  const list = Array.isArray(students) ? students : [];
  if (!list.length) return list;
  const latestMap = await getLatestContactLogsByStudentIds(list.map((student) => clean(student?.id)));
  return list.map((student) => ({
    ...student,
    latestContact: latestMap[clean(student?.id)] || null
  }));
}
