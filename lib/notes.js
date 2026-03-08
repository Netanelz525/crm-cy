import { initDb, sql } from "./db";

export async function getNotesByStudentIds(studentIds) {
  await initDb();
  const ids = (studentIds || []).filter(Boolean);
  if (!ids.length) return {};
  const rows = await sql`
    SELECT
      n.student_id,
      n.note_text,
      n.note_status,
      n.direct_debit_active,
      n.updated_at,
      u.display_name AS signed_by_display_name,
      u.email AS signed_by_email
    FROM student_internal_notes n
    LEFT JOIN app_users u ON u.clerk_user_id = n.signed_by_user_id
    WHERE n.student_id = ANY(${ids})
  `;
  const map = {};
  for (const row of rows) {
    map[row.student_id] = row;
  }
  return map;
}

export async function getNoteByStudentId(studentId) {
  const map = await getNotesByStudentIds([studentId]);
  return map[studentId] || null;
}

export async function upsertStudentNote({ studentId, noteText, noteStatus, directDebitActive, signedByUserId }) {
  await initDb();
  const normalizedStatus = String(noteStatus || "").trim();
  const normalizedDebit =
    String(directDebitActive || "").trim() === "true"
      ? true
      : String(directDebitActive || "").trim() === "false"
        ? false
        : null;

  await sql`
    INSERT INTO student_internal_notes (
      student_id,
      note_text,
      note_status,
      direct_debit_active,
      signed_by_user_id,
      updated_at
    )
    VALUES (
      ${studentId},
      ${String(noteText || "").trim()},
      ${normalizedStatus || null},
      ${normalizedDebit},
      ${signedByUserId || null},
      NOW()
    )
    ON CONFLICT (student_id)
    DO UPDATE SET
      note_text = EXCLUDED.note_text,
      note_status = EXCLUDED.note_status,
      direct_debit_active = EXCLUDED.direct_debit_active,
      signed_by_user_id = EXCLUDED.signed_by_user_id,
      updated_at = NOW()
  `;
}
