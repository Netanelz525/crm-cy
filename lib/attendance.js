import { initDb, sql } from "./db";
import { listNeonStudentsByFilters } from "./neon-students";
import { CLASS_LABELS, INSTITUTIONS } from "./student-view";

export const ATTENDANCE_STATUS_LABELS = {
  present: "נוכח",
  late: "איחר",
  absent: "נעדר",
  excused: "נעדר מוצדק",
  left_early: "יצא מוקדם"
};

function clean(value) {
  return String(value || "").trim();
}

function normalizeInstitution(value) {
  return clean(value).toUpperCase();
}

function normalizeSessionDate(value) {
  const raw = clean(value);
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

export function normalizeAttendanceStatus(value) {
  const raw = clean(value).toLowerCase();
  return ATTENDANCE_STATUS_LABELS[raw] ? raw : "present";
}

function mapSessionRow(row) {
  if (!row) return null;
  const institution = normalizeInstitution(row.institution);
  return {
    id: clean(row.id),
    institution,
    institutionLabel: INSTITUTIONS[institution] || institution || "-",
    title: clean(row.title),
    sessionDate: normalizeSessionDate(row.session_date),
    sourceNote: clean(row.source_note),
    createdByUserId: clean(row.created_by_user_id),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

function mapRecordRow(row) {
  if (!row) return null;
  const status = normalizeAttendanceStatus(row.status);
  return {
    sessionId: clean(row.session_id),
    studentId: clean(row.student_id),
    studentName: clean(row.student_name),
    studentClass: clean(row.student_class),
    studentClassLabel: CLASS_LABELS[clean(row.student_class).toUpperCase()] || clean(row.student_class) || "-",
    status,
    statusLabel: ATTENDANCE_STATUS_LABELS[status] || ATTENDANCE_STATUS_LABELS.present,
    noteText: clean(row.note_text),
    markedByUserId: clean(row.marked_by_user_id),
    markedAt: row.marked_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

export async function createAttendanceSession({
  id,
  institution,
  title,
  sessionDate,
  sourceNote,
  createdByUserId
}) {
  await initDb();
  const sessionId = clean(id);
  const institutionCode = normalizeInstitution(institution);
  const normalizedDate = normalizeSessionDate(sessionDate);
  if (!sessionId) throw new Error("Missing attendance session id.");
  if (!institutionCode) throw new Error("בחר מוסד לפני יצירת מפגש.");
  if (!normalizedDate) throw new Error("בחר תאריך תקין למפגש.");

  await sql`
    INSERT INTO attendance_sessions (
      id,
      institution,
      title,
      session_date,
      source_note,
      created_by_user_id,
      created_at,
      updated_at
    )
    VALUES (
      ${sessionId},
      ${institutionCode},
      ${clean(title)},
      ${normalizedDate},
      ${clean(sourceNote)},
      ${clean(createdByUserId) || null},
      NOW(),
      NOW()
    )
  `;

  return getAttendanceSessionById(sessionId);
}

export async function getAttendanceSessionById(sessionId) {
  await initDb();
  const rows = await sql`
    SELECT id, institution, title, session_date, source_note, created_by_user_id, created_at, updated_at
    FROM attendance_sessions
    WHERE id = ${clean(sessionId)}
    LIMIT 1
  `;
  return mapSessionRow(rows[0] || null);
}

export async function listAttendanceSessions({ institution = "", limit = 12 } = {}) {
  await initDb();
  const institutionCode = normalizeInstitution(institution);
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 12));
  const rows = await sql(
    `
      SELECT id, institution, title, session_date, source_note, created_by_user_id, created_at, updated_at
      FROM attendance_sessions
      WHERE ($1 = '' OR institution = $1)
      ORDER BY session_date DESC, created_at DESC
      LIMIT ${safeLimit}
    `,
    [institutionCode]
  );
  return rows.map(mapSessionRow).filter(Boolean);
}

export async function listStudentsForAttendanceInstitution(institution) {
  const institutionCode = normalizeInstitution(institution);
  if (!institutionCode) return [];
  const students = await listNeonStudentsByFilters({ institution: institutionCode });
  return students.map((student) => {
    const classCode = clean(student?.class).toUpperCase();
    return {
      id: clean(student?.id),
      label: clean(student?.label) || clean(student?.name) || "ללא שם",
      class: classCode,
      classLabel: CLASS_LABELS[classCode] || classCode || "-"
    };
  }).filter((student) => student.id).sort((left, right) => left.label.localeCompare(right.label, "he"));
}

export async function listAttendanceRecordsBySessionId(sessionId) {
  await initDb();
  const rows = await sql`
    SELECT
      session_id,
      student_id,
      student_name,
      student_class,
      status,
      note_text,
      marked_by_user_id,
      marked_at,
      created_at,
      updated_at
    FROM attendance_records
    WHERE session_id = ${clean(sessionId)}
    ORDER BY student_name ASC
  `;
  return rows.map(mapRecordRow).filter(Boolean);
}

export async function listAttendanceHistoryForStudent(studentId, { limit = 12 } = {}) {
  await initDb();
  const normalizedStudentId = clean(studentId);
  if (!normalizedStudentId) return [];
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 12));
  const rows = await sql(
    `
      SELECT
        r.session_id,
        r.student_id,
        r.student_name,
        r.student_class,
        r.status,
        r.note_text,
        r.marked_by_user_id,
        r.marked_at,
        r.created_at,
        r.updated_at,
        s.institution,
        s.title,
        s.session_date
      FROM attendance_records r
      INNER JOIN attendance_sessions s
        ON s.id = r.session_id
      WHERE r.student_id = $1
      ORDER BY s.session_date DESC, r.updated_at DESC
      LIMIT ${safeLimit}
    `,
    [normalizedStudentId]
  );

  return rows.map((row) => {
    const record = mapRecordRow(row);
    const institution = normalizeInstitution(row.institution);
    return {
      ...record,
      institution,
      institutionLabel: INSTITUTIONS[institution] || institution || "-",
      sessionTitle: clean(row.title),
      sessionDate: normalizeSessionDate(row.session_date)
    };
  }).filter(Boolean);
}

export async function getAttendanceSummaryForStudent(studentId) {
  await initDb();
  const normalizedStudentId = clean(studentId);
  if (!normalizedStudentId) {
    return {
      totalSessions: 0,
      attendedSessions: 0,
      present: 0,
      late: 0,
      absent: 0,
      excused: 0,
      leftEarly: 0,
      attendancePercent: 0
    };
  }

  const rows = await sql`
    SELECT
      COUNT(*)::int AS total_sessions,
      COUNT(*) FILTER (WHERE status = 'present')::int AS present_count,
      COUNT(*) FILTER (WHERE status = 'late')::int AS late_count,
      COUNT(*) FILTER (WHERE status = 'absent')::int AS absent_count,
      COUNT(*) FILTER (WHERE status = 'excused')::int AS excused_count,
      COUNT(*) FILTER (WHERE status = 'left_early')::int AS left_early_count
    FROM attendance_records
    WHERE student_id = ${normalizedStudentId}
  `;

  const row = rows[0] || {};
  const totalSessions = Number(row.total_sessions || 0);
  const present = Number(row.present_count || 0);
  const late = Number(row.late_count || 0);
  const absent = Number(row.absent_count || 0);
  const excused = Number(row.excused_count || 0);
  const leftEarly = Number(row.left_early_count || 0);
  const attendedSessions = present + late + leftEarly;
  const attendancePercent = totalSessions
    ? Math.round((attendedSessions / totalSessions) * 1000) / 10
    : 0;

  return {
    totalSessions,
    attendedSessions,
    present,
    late,
    absent,
    excused,
    leftEarly,
    attendancePercent
  };
}

export async function getAttendanceRoster(sessionId) {
  const session = await getAttendanceSessionById(sessionId);
  if (!session) return null;
  const [students, records] = await Promise.all([
    listStudentsForAttendanceInstitution(session.institution),
    listAttendanceRecordsBySessionId(session.id)
  ]);
  const recordMap = new Map(records.map((record) => [record.studentId, record]));
  return {
    session,
    students: students.map((student) => {
      const existing = recordMap.get(student.id);
      const status = normalizeAttendanceStatus(existing?.status || "present");
      return {
        ...student,
        status,
        noteText: clean(existing?.noteText),
        hasSavedRecord: Boolean(existing)
      };
    }),
    stats: buildAttendanceStats(records, students.length)
  };
}

export function buildAttendanceStats(records, totalStudents = 0) {
  const counts = {
    totalStudents: Math.max(0, Number(totalStudents) || 0),
    filledRecords: 0,
    present: 0,
    late: 0,
    absent: 0,
    excused: 0,
    left_early: 0
  };

  for (const record of records || []) {
    const status = normalizeAttendanceStatus(record?.status);
    counts.filledRecords += 1;
    counts[status] = (counts[status] || 0) + 1;
  }

  return counts;
}

export async function saveAttendanceRecords({ sessionId, records, markedByUserId }) {
  await initDb();
  const normalizedSessionId = clean(sessionId);
  if (!normalizedSessionId) throw new Error("Missing attendance session id.");

  for (const record of records || []) {
    const studentId = clean(record?.studentId);
    if (!studentId) continue;
    const status = normalizeAttendanceStatus(record?.status);
    const studentName = clean(record?.studentName) || "ללא שם";
    const studentClass = clean(record?.studentClass).toUpperCase();
    const noteText = clean(record?.noteText);

    await sql`
      INSERT INTO attendance_records (
        session_id,
        student_id,
        student_name,
        student_class,
        status,
        note_text,
        marked_by_user_id,
        marked_at,
        created_at,
        updated_at
      )
      VALUES (
        ${normalizedSessionId},
        ${studentId},
        ${studentName},
        ${studentClass},
        ${status},
        ${noteText},
        ${clean(markedByUserId) || null},
        NOW(),
        NOW(),
        NOW()
      )
      ON CONFLICT (session_id, student_id)
      DO UPDATE SET
        student_name = EXCLUDED.student_name,
        student_class = EXCLUDED.student_class,
        status = EXCLUDED.status,
        note_text = EXCLUDED.note_text,
        marked_by_user_id = EXCLUDED.marked_by_user_id,
        marked_at = NOW(),
        updated_at = NOW()
    `;
  }

  await sql`
    UPDATE attendance_sessions
    SET updated_at = NOW()
    WHERE id = ${normalizedSessionId}
  `;
}
