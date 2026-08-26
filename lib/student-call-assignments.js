import { initDb, sql } from "./db.js";

const clean = (value) => String(value || "").trim();

async function ensureTable() {
  await initDb();
  await sql`CREATE TABLE IF NOT EXISTS student_call_assignments (
    student_id TEXT PRIMARY KEY,
    assignee_user_id TEXT NOT NULL REFERENCES app_users(clerk_user_id) ON DELETE CASCADE,
    assigned_by_user_id TEXT REFERENCES app_users(clerk_user_id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed')),
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`ALTER TABLE student_call_assignments ALTER COLUMN assignee_user_id DROP NOT NULL`;
  await sql`ALTER TABLE student_call_assignments ADD COLUMN IF NOT EXISTS assignee_student_id TEXT`;
  await sql`CREATE INDEX IF NOT EXISTS idx_student_call_assignments_user ON student_call_assignments (assignee_user_id, status, updated_at)`;
}

export async function listCallAssignments() {
  await ensureTable();
  return sql`SELECT * FROM student_call_assignments ORDER BY updated_at DESC`;
}

export async function assignStudentCall({ studentId, assigneeUserId, assigneeStudentId, assignedByUserId }) {
  await ensureTable();
  if (!clean(studentId)) throw new Error("חסר בוגר להקצאה.");
  if (!clean(assigneeUserId) && !clean(assigneeStudentId)) { await sql`DELETE FROM student_call_assignments WHERE student_id=${clean(studentId)}`; return null; }
  const rows = await sql`INSERT INTO student_call_assignments (student_id, assignee_user_id, assignee_student_id, assigned_by_user_id, status, updated_at)
    VALUES (${clean(studentId)},${clean(assigneeUserId)||null},${clean(assigneeStudentId)||null},${clean(assignedByUserId)||null},'pending',NOW())
    ON CONFLICT (student_id) DO UPDATE SET assignee_user_id=EXCLUDED.assignee_user_id, assignee_student_id=EXCLUDED.assignee_student_id, assigned_by_user_id=EXCLUDED.assigned_by_user_id, status='pending', updated_at=NOW() RETURNING *`;
  return rows[0];
}

export async function completeStudentCall({ studentId, userId, linkedStudentId }) {
  await ensureTable();
  await sql`UPDATE student_call_assignments SET status='completed', updated_at=NOW() WHERE student_id=${clean(studentId)} AND (assignee_user_id=${clean(userId)} OR assignee_student_id=${clean(linkedStudentId)})`;
}
