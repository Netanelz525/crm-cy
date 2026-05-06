import { initDb, sql } from "./db";

function clean(value) {
  return String(value || "").trim();
}

export async function createSoftDeletedStudentRecord({ studentId, studentName, deletedByUserId, snapshot }) {
  const normalizedStudentId = clean(studentId);
  if (!normalizedStudentId) throw new Error("לא נבחר תלמיד למחיקה");

  await initDb();
  await sql`
    INSERT INTO deleted_students (student_id, student_name, deleted_by_user_id, snapshot_json, deleted_at, delete_after_at)
    VALUES (
      ${normalizedStudentId},
      ${clean(studentName) || "תלמיד ללא שם"},
      ${clean(deletedByUserId) || null},
      ${snapshot || {}},
      NOW(),
      NOW() + INTERVAL '30 days'
    )
    ON CONFLICT (student_id) DO UPDATE
    SET
      student_name = EXCLUDED.student_name,
      deleted_by_user_id = EXCLUDED.deleted_by_user_id,
      snapshot_json = EXCLUDED.snapshot_json,
      deleted_at = NOW(),
      delete_after_at = NOW() + INTERVAL '30 days'
  `;
}

export async function removeSoftDeletedStudentRecord(studentId) {
  await initDb();
  await sql`
    DELETE FROM deleted_students
    WHERE student_id = ${clean(studentId)}
  `;
}

export async function isSoftDeletedStudentId(studentId) {
  const normalizedStudentId = clean(studentId);
  if (!normalizedStudentId) return false;

  await initDb();
  const rows = await sql`
    SELECT student_id
    FROM deleted_students
    WHERE student_id = ${normalizedStudentId}
    LIMIT 1
  `;
  return rows.length > 0;
}

export async function getSoftDeletedStudentIdSet(studentIds) {
  const normalizedStudentIds = Array.isArray(studentIds) ? studentIds.map(clean).filter(Boolean) : [];
  if (!normalizedStudentIds.length) return new Set();

  await initDb();
  const rows = await sql`
    SELECT student_id
    FROM deleted_students
    WHERE student_id = ANY(${normalizedStudentIds})
  `;
  return new Set(rows.map((row) => clean(row.student_id)).filter(Boolean));
}

export async function listSoftDeletedStudents() {
  await initDb();
  return sql`
    SELECT
      student_id,
      student_name,
      deleted_by_user_id,
      snapshot_json,
      deleted_at,
      delete_after_at
    FROM deleted_students
    ORDER BY deleted_at DESC
  `;
}

export async function listExpiredSoftDeletedStudents(limit = 50) {
  await initDb();
  return sql`
    SELECT
      student_id,
      student_name,
      deleted_by_user_id,
      snapshot_json,
      deleted_at,
      delete_after_at
    FROM deleted_students
    WHERE delete_after_at <= NOW()
    ORDER BY delete_after_at ASC
    LIMIT ${Math.max(1, Number(limit) || 50)}
  `;
}
