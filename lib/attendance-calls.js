import { randomUUID } from "node:crypto";
import { initDb, sql } from "./db";
import { getAttendanceRoster } from "./attendance";
import { listAllNeonStudents } from "./neon-students";

const clean = (value) => String(value || "").trim();
export class CallQueueError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const CALL_OUTCOMES = { completed: "טופל", deferred: "נדחה", no_answer: "לא ענה" };
let ready;
export async function ensureAttendanceCalls() {
  if (!ready) ready = (async () => {
    await initDb();
    await sql.transaction([
    sql`SELECT pg_advisory_xact_lock(18474206)`,
    sql`CREATE TABLE IF NOT EXISTS attendance_call_teams (
      session_id TEXT PRIMARY KEY REFERENCES attendance_sessions(id) ON DELETE CASCADE,
      student_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]
    )`,
    sql`CREATE TABLE IF NOT EXISTS attendance_call_leads (
      session_id TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL,
      outcome TEXT NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending','completed','deferred','no_answer')),
      available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      caller_key TEXT, lease_token TEXT, lease_until TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (session_id, student_id)
    )`,
    sql`CREATE UNIQUE INDEX IF NOT EXISTS attendance_call_one_lead_per_caller
      ON attendance_call_leads(session_id, caller_key) WHERE caller_key IS NOT NULL`,
    sql`CREATE TABLE IF NOT EXISTS attendance_call_attempts (
      token TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL, caller_user_id TEXT REFERENCES app_users(clerk_user_id) ON DELETE SET NULL,
      outcome TEXT NOT NULL, attendance_status TEXT, note TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    sql`CREATE INDEX IF NOT EXISTS attendance_call_attempts_session ON attendance_call_attempts(session_id, created_at DESC)`
    ]);
  })().catch((error) => { ready = null; throw error; });
  await ready;
}

function requireApproved(user) {
  if (!user || user.access_status !== "approved") throw new CallQueueError("אין הרשאה למוקד המפגש.", 403);
}
function requireManager(user) {
  requireApproved(user);
  if (!user.is_manager && !user.is_super_admin) throw new CallQueueError("רק מנהל יכול לשנות את צוות המתקשרים.", 403);
}
const callerKey = (user) => user.linked_student_id ? `student:${user.linked_student_id}` : `user:${user.clerk_user_id}`;

export async function listMyCallSessions(user) {
  requireApproved(user);
  await ensureAttendanceCalls();
  return sql`SELECT s.id, s.title, s.session_date, s.is_locked, s.session_type FROM attendance_sessions s
    JOIN attendance_call_teams t ON t.session_id=s.id
    WHERE ${Boolean(user.is_manager || user.is_super_admin)} OR ${clean(user.linked_student_id)}=ANY(t.student_ids)
    ORDER BY s.session_date DESC, s.created_at DESC`;
}

export async function getCallTeam(sessionId, user) {
  requireManager(user);
  await ensureAttendanceCalls();
  const [teams, students, leads, attempts] = await Promise.all([
    sql`SELECT student_ids FROM attendance_call_teams WHERE session_id=${sessionId}`,
    listAllNeonStudents(),
    sql`SELECT student_id, outcome, caller_key, lease_until, available_at FROM attendance_call_leads WHERE session_id=${sessionId}`,
    sql`SELECT a.*, u.display_name AS caller_name FROM attendance_call_attempts a
      LEFT JOIN app_users u ON u.clerk_user_id=a.caller_user_id
      WHERE a.session_id=${sessionId} ORDER BY a.created_at DESC LIMIT 100`
  ]);
  return { selected: teams[0]?.student_ids || [], students: students.map(s => ({id:s.id, label:s.label || s.name || s.id})), leads, attempts };
}

export async function saveCallTeam(sessionId, studentIds, user) {
  requireManager(user);
  await ensureAttendanceCalls();
  if (!Array.isArray(studentIds) || studentIds.length > 200) throw new CallQueueError("בחר עד 200 תלמידים אחראים.");
  const ids = [...new Set(studentIds.map(clean).filter(Boolean))];
  const known = new Set((await listAllNeonStudents()).map(s => s.id));
  if (ids.some(id => !known.has(id))) throw new CallQueueError("נבחר תלמיד שאינו קיים.");
  const result = await sql.transaction([
    sql`SELECT id FROM attendance_sessions WHERE id=${sessionId} FOR UPDATE`,
    sql`INSERT INTO attendance_call_teams(session_id, student_ids) VALUES (${sessionId},${ids}::text[])
      ON CONFLICT(session_id) DO UPDATE SET student_ids=EXCLUDED.student_ids`,
    sql`UPDATE attendance_call_leads SET caller_key=NULL, lease_token=NULL, lease_until=NULL
      WHERE session_id=${sessionId} AND caller_key LIKE 'student:%'
      AND NOT (substring(caller_key FROM 9)=ANY(${ids}::text[]))`
  ], { isolationLevel: "ReadCommitted" });
  return result[0];
}

async function accessRoster(sessionId, user) {
  requireApproved(user);
  await ensureAttendanceCalls();
  const teams = await sql`SELECT student_ids FROM attendance_call_teams WHERE session_id=${sessionId}`;
  if (!teams.length || (!user.is_manager && !user.is_super_admin && !teams[0].student_ids.includes(user.linked_student_id))) {
    throw new CallQueueError("אינך משויך לצוות המתקשרים של המפגש.", 403);
  }
  const roster = await getAttendanceRoster(sessionId);
  if (!roster) throw new CallQueueError("המפגש לא נמצא.", 404);
  if (roster.session.isLocked) throw new CallQueueError("המפגש נעול. פנה למנהל לפתיחת המפגש.", 409);
  return roster;
}

// All queue mutations lock the same session row, then use fresh READ COMMITTED
// snapshots. A single HTTP transaction owns the connection and releases the lock.
async function mutate(sessionId, user, queries, sessionVersion) {
  try {
    return await sql.transaction([
      sql`SELECT id FROM attendance_sessions WHERE id=${sessionId} FOR UPDATE`,
      // Recheck membership after acquiring the lock (team removal uses this lock too).
      sql`SELECT 1 / COUNT(*)::int AS allowed FROM attendance_sessions s
        JOIN attendance_call_teams t ON t.session_id=s.id JOIN app_users u ON u.clerk_user_id=${user.clerk_user_id}
        WHERE s.id=${sessionId} AND NOT COALESCE(s.is_locked,FALSE) AND u.access_status='approved'
        AND COALESCE(u.linked_student_id,'')=${clean(user.linked_student_id)}
        AND s.updated_at=${sessionVersion}::timestamptz
        AND (LOWER(u.role) IN ('admin','editor','super_admin') OR u.linked_student_id=ANY(t.student_ids))`,
      ...queries
    ], { isolationLevel: "ReadCommitted" });
  } catch (error) {
    if (error.code === "22012") throw new CallQueueError("ההרשאה השתנתה או שהמפגש ננעל. רענן את העמוד.", 403);
    throw error;
  }
}

export async function claimAttendanceCall(sessionId, user) {
  const roster = await accessRoster(sessionId, user);
  const ids = roster.students.map(s => s.id);
  const key = callerKey(user);
  const token = randomUUID();
  const results = await mutate(sessionId, user, [
    sql`INSERT INTO attendance_call_leads(session_id,student_id)
      SELECT ${sessionId}, unnest(${ids}::text[]) ON CONFLICT DO NOTHING`,
    sql`UPDATE attendance_call_leads SET caller_key=NULL, lease_token=NULL, lease_until=NULL
      WHERE session_id=${sessionId} AND (lease_until<=clock_timestamp() OR NOT(student_id=ANY(${ids}::text[])))`,
    sql`WITH candidate AS (
      SELECT student_id FROM attendance_call_leads WHERE session_id=${sessionId} AND student_id=ANY(${ids}::text[])
      AND (caller_key=${key} OR (caller_key IS NULL AND outcome<>'completed' AND available_at<=clock_timestamp()))
      ORDER BY (caller_key=${key}) DESC NULLS LAST, available_at, student_id LIMIT 1
    ) UPDATE attendance_call_leads l SET caller_key=${key},
      lease_token=CASE WHEN l.caller_key=${key} THEN l.lease_token ELSE ${token} END,
      lease_until=CASE WHEN l.caller_key=${key} THEN l.lease_until ELSE clock_timestamp()+INTERVAL '5 minutes' END
      FROM candidate c WHERE l.session_id=${sessionId} AND l.student_id=c.student_id RETURNING l.*`,
    sql`SELECT COUNT(*)::int AS total, COUNT(*) FILTER(WHERE outcome='completed')::int AS completed,
      COUNT(*) FILTER(WHERE lease_until>clock_timestamp())::int AS active,
      MIN(available_at) FILTER(WHERE caller_key IS NULL AND outcome<>'completed' AND available_at>clock_timestamp()) AS next_available_at
      FROM attendance_call_leads WHERE session_id=${sessionId} AND student_id=ANY(${ids}::text[])`
  ], roster.session.updatedAt);
  const lead = results[4][0];
  const student = lead ? roster.students.find(s => s.id === lead.student_id) : null;
  const history = lead ? await sql`SELECT outcome, attendance_status, note, created_at FROM attendance_call_attempts
    WHERE session_id=${sessionId} AND student_id=${lead.student_id} ORDER BY created_at DESC LIMIT 5` : [];
  // Never send the entire roster or full student cards to a caller.
  return { session: { id:sessionId, title:roster.session.displayTitle || roster.session.title || roster.session.sessionTypeLabel,
    statusOptions:roster.session.statusOptions.map(([value,label]) => ({value,label})) }, stats:results[5][0], serverTime:new Date().toISOString(),
    lead:student ? { studentId:student.id, name:student.label, classLabel:student.classLabel,
      phone:student.phone, status:student.status, token:lead.lease_token, expiresAt:lead.lease_until, history } : null };
}

export async function finishAttendanceCall(sessionId, input, user) {
  const roster = await accessRoster(sessionId, user);
  const outcome = clean(input.outcome);
  if (!Object.hasOwn(CALL_OUTCOMES, outcome)) throw new CallQueueError("בחר תוצאת שיחה תקינה.");
  const student = roster.students.find(s => s.id === clean(input.studentId));
  if (!student) throw new CallQueueError("התלמיד אינו ברשימת המוזמנים למפגש.", 409);
  const status = outcome === "completed" ? clean(input.attendanceStatus) : "";
  if (status && !roster.session.statusOptions.some(([value]) => value === status)) throw new CallQueueError("סטטוס הנוכחות אינו תקין.");
  const note = clean(input.note);
  if (note.length > 4000) throw new CallQueueError("סיכום השיחה מוגבל ל־4,000 תווים.");
  const delay = outcome === "no_answer" ? 15 : outcome === "deferred" ? 5 : 0;
  const key = callerKey(user);
  const token = clean(input.token);
  if (!token) throw new CallQueueError("חסרה הקצאה פעילה.", 409);
  const logNote = `[מפגש: ${roster.session.displayTitle || roster.session.title || sessionId}] ${CALL_OUTCOMES[outcome]}${note ? ` — ${note}` : ""}`;
  const result = await mutate(sessionId, user, [
    sql`WITH accepted AS (
      UPDATE attendance_call_leads SET outcome=${outcome}, available_at=clock_timestamp()+${delay}*INTERVAL '1 minute',
        caller_key=NULL, lease_token=NULL, lease_until=NULL, updated_at=clock_timestamp()
      WHERE session_id=${sessionId} AND student_id=${student.id} AND caller_key=${key}
        AND lease_token=${token} AND lease_until>clock_timestamp() RETURNING student_id
    ), attempt AS (
      INSERT INTO attendance_call_attempts(token,session_id,student_id,caller_user_id,outcome,attendance_status,note)
      SELECT ${token},${sessionId},student_id,${user.clerk_user_id},${outcome},${status || null},${note} FROM accepted RETURNING *
    ), contact AS (
      INSERT INTO student_contact_logs(id,student_id,contact_date,note_text,created_by_user_id)
      SELECT ${randomUUID()},student_id,(clock_timestamp() AT TIME ZONE 'Asia/Jerusalem')::date,${logNote},${user.clerk_user_id} FROM attempt
    ), attendance AS (
      INSERT INTO attendance_records(session_id,student_id,student_name,student_class,status,note_text,marked_by_user_id,marked_at)
      SELECT ${sessionId},student_id,${student.label},${student.class},${status},${note},${user.clerk_user_id},clock_timestamp()
      FROM attempt WHERE ${status}<>''
      ON CONFLICT(session_id,student_id) DO UPDATE SET status=EXCLUDED.status,
        note_text=CASE WHEN EXCLUDED.note_text<>'' THEN EXCLUDED.note_text ELSE attendance_records.note_text END,
        marked_by_user_id=EXCLUDED.marked_by_user_id,marked_at=EXCLUDED.marked_at,updated_at=clock_timestamp()
    ) SELECT token FROM attempt`,
    sql`SELECT token FROM attendance_call_attempts WHERE token=${token} AND session_id=${sessionId}
      AND student_id=${student.id} AND caller_user_id=${user.clerk_user_id}`
  ], roster.session.updatedAt);
  if (!result[3].length) throw new CallQueueError("ההקצאה פגה או שהתלמיד הועבר למתקשר אחר. קבל תלמיד חדש.", 409);
  return { ok:true };
}
