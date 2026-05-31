import { initDb, sql } from "./db";
import { listNeonStudentsByFilters } from "./neon-students";
import { ENUM_LABELS } from "./student-fields";
import { CLASS_LABELS, CLASS_ORDER, getLastName, INSTITUTIONS } from "./student-view";

export const ATTENDANCE_STATUS_LABELS = {
  found: "נמצא",
  missing: "לא נמצא",
  late: "איחר",
  sent_home: "נשלח לבית"
};

export const ATTENDANCE_SESSION_TYPE_LABELS = {
  shacharit: "שחרית",
  seder_a: "סדר א",
  mincha: "מנחה",
  seder_b_part_a: "סדר ב חלק א",
  seder_b_part_b: "סדר ב חלק ב",
  seder_g: "סדר ג",
  maariv: "מעריב",
  manager_default: "מפגש מנהל"
};

export const ATTENDANCE_SESSION_TYPE_ORDER = [
  "shacharit",
  "seder_a",
  "mincha",
  "seder_b_part_a",
  "seder_b_part_b",
  "seder_g",
  "maariv"
];

export const ATTENDANCE_SELECTABLE_SESSION_TYPE_ORDER = [
  ...ATTENDANCE_SESSION_TYPE_ORDER,
  "manager_default"
];

export const ATTENDANCE_SUMMARY_SORT_LABELS = {
  class_name: "שיעור ושם משפחה",
  absence_rate: "אחוז היעדרות"
};

function clean(value) {
  return String(value || "").trim();
}

function unique(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function normalizeCodeList(values, options = {}) {
  const allowedKeys = new Set(Object.keys(options || {}).map((key) => clean(key).toUpperCase()).filter(Boolean));
  return unique((Array.isArray(values) ? values : [values])
    .map((value) => clean(value).toUpperCase())
    .filter((value) => !allowedKeys.size || allowedKeys.has(value)));
}

function mapFilterOptions(values, options = {}) {
  return normalizeCodeList(values, options).map((value) => ({
    value,
    label: options[value] || value
  }));
}

function normalizeClassFilters(values) {
  return normalizeCodeList(values, CLASS_LABELS);
}

function normalizeRegistrationFilters(values) {
  return normalizeCodeList(values, ENUM_LABELS.registration || {});
}

function normalizeFamilyStatusFilters(values) {
  return normalizeCodeList(values, ENUM_LABELS.familystatus || {});
}

function normalizeInstitution(value) {
  return clean(value).toUpperCase();
}

function normalizeInstitutionFilters(values) {
  return normalizeCodeList(values, INSTITUTIONS);
}

function normalizeSessionDate(value) {
  const raw = clean(value);
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function parseSessionDate(value) {
  const normalized = normalizeSessionDate(value);
  if (!normalized) return null;
  const parsed = new Date(`${normalized}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatHebrewDate(value) {
  const date = parseSessionDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("he-IL-u-ca-hebrew", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function formatWeekday(value) {
  const date = parseSessionDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("he-IL", {
    weekday: "long",
    timeZone: "UTC"
  }).format(date);
}

export function normalizeAttendanceStatus(value) {
  const raw = clean(value).toLowerCase();
  if (raw === "present") return "found";
  if (raw === "absent") return "missing";
  if (raw === "excused") return "missing";
  if (raw === "left_early") return "sent_home";
  return ATTENDANCE_STATUS_LABELS[raw] ? raw : "missing";
}

export function normalizeAttendanceSessionType(value) {
  const raw = clean(value).toLowerCase();
  if (raw === "seder_b") return "seder_b_part_a";
  return ATTENDANCE_SESSION_TYPE_LABELS[raw] ? raw : "";
}

function isSummaryAttendanceSessionType(sessionType) {
  return ATTENDANCE_SESSION_TYPE_ORDER.includes(normalizeAttendanceSessionType(sessionType));
}

function mapSessionFilters(row) {
  const institutionFilter = normalizeInstitutionFilters(row?.institution_filter);
  const classFilter = normalizeClassFilters(row?.class_filter);
  const registrationFilter = normalizeRegistrationFilters(row?.registration_filter);
  const familyStatusFilter = normalizeFamilyStatusFilters(row?.family_status_filter);
  return {
    institutionFilter,
    institutionFilterOptions: mapFilterOptions(institutionFilter, INSTITUTIONS),
    classFilter,
    classFilterOptions: mapFilterOptions(classFilter, CLASS_LABELS),
    registrationFilter,
    registrationFilterOptions: mapFilterOptions(registrationFilter, ENUM_LABELS.registration || {}),
    familyStatusFilter,
    familyStatusFilterOptions: mapFilterOptions(familyStatusFilter, ENUM_LABELS.familystatus || {})
  };
}

function isAttendedStatus(status) {
  const normalized = normalizeAttendanceStatus(status);
  return normalized === "found" || normalized === "late" || normalized === "sent_home";
}

function classSortValue(classCode) {
  const key = clean(classCode).toUpperCase();
  return Number(CLASS_ORDER?.[key] || 999);
}

function mapSessionRow(row) {
  if (!row) return null;
  const institution = normalizeInstitution(row.institution);
  const sessionType = normalizeAttendanceSessionType(row.session_type);
  const sessionTypeLabel = ATTENDANCE_SESSION_TYPE_LABELS[sessionType] || clean(row.title);
  const filters = mapSessionFilters(row);
  const sessionDate = normalizeSessionDate(row.session_date);
  return {
    id: clean(row.id),
    institution,
    institutionLabel: INSTITUTIONS[institution] || institution || "-",
    title: sessionTypeLabel,
    sessionType,
    sessionTypeLabel,
    sessionDate,
    sessionWeekdayLabel: formatWeekday(sessionDate),
    sessionHebrewDateLabel: formatHebrewDate(sessionDate),
    sourceNote: clean(row.source_note),
    institutionFilter: filters.institutionFilter,
    institutionFilterOptions: filters.institutionFilterOptions,
    classFilter: filters.classFilter,
    classFilterOptions: filters.classFilterOptions,
    registrationFilter: filters.registrationFilter,
    registrationFilterOptions: filters.registrationFilterOptions,
    familyStatusFilter: filters.familyStatusFilter,
    familyStatusFilterOptions: filters.familyStatusFilterOptions,
    createdByUserId: clean(row.created_by_user_id),
    createdByDisplayName: clean(row.created_by_display_name) || clean(row.created_by_user_id) || "לא ידוע",
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
    statusLabel: ATTENDANCE_STATUS_LABELS[status] || ATTENDANCE_STATUS_LABELS.found,
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
  sessionType,
  title,
  sessionDate,
  sourceNote,
  institutionFilter = [],
  classFilter = [],
  registrationFilter = [],
  familyStatusFilter = [],
  createdByUserId
}) {
  await initDb();
  const sessionId = clean(id);
  const institutionCode = normalizeInstitution(institution);
  const normalizedSessionType = normalizeAttendanceSessionType(sessionType);
  const normalizedDate = normalizeSessionDate(sessionDate);
  const normalizedInstitutionFilter = normalizeInstitutionFilters(institutionFilter);
  const normalizedClassFilter = normalizeClassFilters(classFilter);
  const normalizedRegistrationFilter = normalizeRegistrationFilters(registrationFilter);
  const normalizedFamilyStatusFilter = normalizeFamilyStatusFilters(familyStatusFilter);
  if (!sessionId) throw new Error("Missing attendance session id.");
  if (!normalizedSessionType) throw new Error("בחר סוג מפגש לפני יצירת מפגש.");
  if (!normalizedDate) throw new Error("בחר תאריך תקין למפגש.");

  const storedInstitution = institutionCode || (normalizedInstitutionFilter.length === 1 ? normalizedInstitutionFilter[0] : "ALL");

  await sql`
    INSERT INTO attendance_sessions (
      id,
      institution,
      session_type,
      title,
      session_date,
      source_note,
      institution_filter,
      class_filter,
      registration_filter,
      family_status_filter,
      created_by_user_id,
      created_at,
      updated_at
    )
    VALUES (
      ${sessionId},
      ${storedInstitution},
      ${normalizedSessionType},
      ${clean(title) || ATTENDANCE_SESSION_TYPE_LABELS[normalizedSessionType]},
      ${normalizedDate},
      ${clean(sourceNote)},
      ${normalizedInstitutionFilter},
      ${normalizedClassFilter},
      ${normalizedRegistrationFilter},
      ${normalizedFamilyStatusFilter},
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
    SELECT
      s.id,
      s.institution,
      s.session_type,
      s.title,
      s.session_date,
      s.source_note,
      s.institution_filter,
      s.class_filter,
      s.registration_filter,
      s.family_status_filter,
      s.created_by_user_id,
      s.created_at,
      s.updated_at,
      u.display_name AS created_by_display_name
    FROM attendance_sessions s
    LEFT JOIN app_users u
      ON u.clerk_user_id = s.created_by_user_id
    WHERE s.id = ${clean(sessionId)}
    LIMIT 1
  `;
  return mapSessionRow(rows[0] || null);
}

export async function listAttendanceSessions({
  institution = "",
  dateFrom = "",
  dateTo = "",
  limit = 12
} = {}) {
  await initDb();
  const institutionCode = normalizeInstitution(institution);
  const normalizedDateFrom = normalizeSessionDate(dateFrom);
  const normalizedDateTo = normalizeSessionDate(dateTo);
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 12));
  const rows = await sql(
    `
      SELECT
        s.id,
        s.institution,
        s.session_type,
        s.title,
        s.session_date,
        s.source_note,
        s.institution_filter,
        s.class_filter,
        s.registration_filter,
        s.family_status_filter,
        s.created_by_user_id,
        s.created_at,
        s.updated_at,
        u.display_name AS created_by_display_name
      FROM attendance_sessions s
      LEFT JOIN app_users u
        ON u.clerk_user_id = s.created_by_user_id
      WHERE (
        $1 = ''
        OR s.institution = $1
        OR s.institution = 'ALL'
        OR $1 = ANY(COALESCE(s.institution_filter, ARRAY[]::TEXT[]))
      )
        AND (NULLIF($2, '') IS NULL OR s.session_date >= NULLIF($2, '')::date)
        AND (NULLIF($3, '') IS NULL OR s.session_date <= NULLIF($3, '')::date)
      ORDER BY s.session_date DESC, s.created_at DESC
      LIMIT ${safeLimit}
    `,
    [institutionCode, normalizedDateFrom, normalizedDateTo]
  );
  return rows.map(mapSessionRow).filter(Boolean);
}

export async function getAttendanceSummaryReport({
  institution = "",
  dateFrom = "",
  dateTo = "",
  sort = "class_name"
} = {}) {
  await initDb();
  const institutionCode = normalizeInstitution(institution);
  const normalizedDateFrom = normalizeSessionDate(dateFrom);
  const normalizedDateTo = normalizeSessionDate(dateTo);

  if (!institutionCode || !normalizedDateFrom || !normalizedDateTo) {
    return null;
  }

  const [students, sessions, records] = await Promise.all([
    listStudentsForAttendanceInstitution(institutionCode),
    sql(
      `
        SELECT id, session_type, session_date
        FROM attendance_sessions
        WHERE institution = $1
          AND session_date >= $2::date
          AND session_date <= $3::date
        ORDER BY session_date ASC, created_at ASC
      `,
      [institutionCode, normalizedDateFrom, normalizedDateTo]
    ),
    sql(
      `
        SELECT
          r.session_id,
          r.student_id,
          r.status
        FROM attendance_records r
        INNER JOIN attendance_sessions s
          ON s.id = r.session_id
        WHERE s.institution = $1
          AND s.session_date >= $2::date
          AND s.session_date <= $3::date
      `,
      [institutionCode, normalizedDateFrom, normalizedDateTo]
    )
  ]);
  const summarySessions = (sessions || []).filter((session) => isSummaryAttendanceSessionType(session.session_type));

  const sessionsByType = Object.fromEntries(
    ATTENDANCE_SESSION_TYPE_ORDER.map((sessionType) => [
      sessionType,
      {
        sessionType,
        label: ATTENDANCE_SESSION_TYPE_LABELS[sessionType],
        totalSessions: 0
      }
    ])
  );

  for (const session of summarySessions) {
    const sessionType = normalizeAttendanceSessionType(session.session_type);
    if (!sessionType || !sessionsByType[sessionType]) continue;
    sessionsByType[sessionType].totalSessions += 1;
  }

  const recordMap = new Map(
    (records || []).map((record) => [
      `${clean(record.student_id)}:${clean(record.session_id)}`,
      normalizeAttendanceStatus(record.status)
    ])
  );

  const rows = (students || []).map((student) => {
    const byType = Object.fromEntries(
      ATTENDANCE_SESSION_TYPE_ORDER.map((sessionType) => [
        sessionType,
        {
          attended: 0,
          total: sessionsByType[sessionType]?.totalSessions || 0,
          percent: 0,
          displayValue: "0/0"
        }
      ])
    );

    let attendedSessions = 0;

    for (const session of summarySessions) {
      const sessionType = normalizeAttendanceSessionType(session.session_type);
      if (!sessionType || !byType[sessionType]) continue;
      const status = recordMap.get(`${student.id}:${clean(session.id)}`) || "missing";
      if (isAttendedStatus(status)) {
        byType[sessionType].attended += 1;
        attendedSessions += 1;
      }
    }

    for (const sessionType of ATTENDANCE_SESSION_TYPE_ORDER) {
      const cell = byType[sessionType];
      cell.percent = cell.total ? Math.round((cell.attended / cell.total) * 1000) / 10 : 0;
      cell.displayValue = `${cell.attended}/${cell.total}`;
    }

    const totalSessions = summarySessions.length;
    const overallPercent = totalSessions
      ? Math.round((attendedSessions / totalSessions) * 1000) / 10
      : 0;

    return {
      id: student.id,
      label: student.label,
      class: student.class,
      classLabel: student.classLabel,
      firstName: student.firstName,
      lastName: student.lastName,
      byType,
      overall: {
        attended: attendedSessions,
        total: totalSessions,
        percent: overallPercent,
        displayValue: `${attendedSessions}/${totalSessions}`
      }
    };
  }).sort((left, right) => (
    (clean(sort).toLowerCase() === "absence_rate"
      ? Number(left.overall?.percent ?? 0) - Number(right.overall?.percent ?? 0)
      : 0)
    || classSortValue(left.class) - classSortValue(right.class)
    || clean(left.lastName).localeCompare(clean(right.lastName), "he")
    || clean(left.firstName).localeCompare(clean(right.firstName), "he")
    || clean(left.label).localeCompare(clean(right.label), "he")
  ));

  return {
    institution: institutionCode,
    institutionLabel: INSTITUTIONS[institutionCode] || institutionCode || "-",
    dateFrom: normalizedDateFrom,
    dateTo: normalizedDateTo,
    totalStudents: rows.length,
    totalSessions: summarySessions.length,
    sessionTypeTotals: ATTENDANCE_SESSION_TYPE_ORDER.map((sessionType) => sessionsByType[sessionType]),
    rows
  };
}

export async function listStudentsForAttendanceInstitution(input) {
  const institutionCode = typeof input === "string"
    ? normalizeInstitution(input)
    : normalizeInstitution(input?.institution);
  const institutionFilter = typeof input === "object"
    ? normalizeInstitutionFilters(input?.institutionFilter)
    : [];
  if (!institutionCode && !institutionFilter.length) return [];
  const classFilter = typeof input === "object" ? normalizeClassFilters(input?.classFilter) : [];
  const registrationFilter = typeof input === "object" ? normalizeRegistrationFilters(input?.registrationFilter) : [];
  const familyStatusFilter = typeof input === "object" ? normalizeFamilyStatusFilters(input?.familyStatusFilter) : [];
  const students = await listNeonStudentsByFilters({
    institution: institutionFilter.length ? institutionFilter : (institutionCode && institutionCode !== "ALL" ? [institutionCode] : []),
    class: classFilter,
    registration: registrationFilter,
    famliystatus: familyStatusFilter
  });
  return students.map((student) => {
    const classCode = clean(student?.class).toUpperCase();
    return {
      id: clean(student?.id),
      label: clean(student?.label) || clean(student?.name) || "ללא שם",
      firstName: clean(student?.fullName?.firstName),
      lastName: clean(student?.fullName?.lastName) || getLastName(student),
      class: classCode,
      classLabel: CLASS_LABELS[classCode] || classCode || "-",
      macAddress: clean(student?.macAddress),
      phone: student?.phone || null,
      dadPhone: student?.dadPhone || null,
      momPhone: student?.momPhone || null
    };
  }).filter((student) => student.id).sort((left, right) => (
    classSortValue(left.class) - classSortValue(right.class)
    || clean(left.lastName).localeCompare(clean(right.lastName), "he")
    || clean(left.firstName).localeCompare(clean(right.firstName), "he")
    || clean(left.label).localeCompare(clean(right.label), "he")
  ));
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
        s.session_type,
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
      sessionType: normalizeAttendanceSessionType(row.session_type),
      sessionTitle: ATTENDANCE_SESSION_TYPE_LABELS[normalizeAttendanceSessionType(row.session_type)] || clean(row.title) || "מפגש נוכחות",
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
      found: 0,
      late: 0,
      missing: 0,
      sentHome: 0,
      attendancePercent: 0
    };
  }

  const rows = await sql`
    SELECT
      COUNT(*)::int AS total_sessions,
      COUNT(*) FILTER (WHERE status = 'found')::int AS found_count,
      COUNT(*) FILTER (WHERE status = 'late')::int AS late_count,
      COUNT(*) FILTER (WHERE status = 'missing')::int AS missing_count,
      COUNT(*) FILTER (WHERE status = 'sent_home')::int AS sent_home_count
    FROM attendance_records
    WHERE student_id = ${normalizedStudentId}
  `;

  const row = rows[0] || {};
  const totalSessions = Number(row.total_sessions || 0);
  const found = Number(row.found_count || 0);
  const late = Number(row.late_count || 0);
  const missing = Number(row.missing_count || 0);
  const sentHome = Number(row.sent_home_count || 0);
  const attendedSessions = found + late + sentHome;
  const attendancePercent = totalSessions
    ? Math.round((attendedSessions / totalSessions) * 1000) / 10
    : 0;

  return {
    totalSessions,
    attendedSessions,
    found,
    late,
    missing,
    sentHome,
    attendancePercent
  };
}

export async function getAttendanceRoster(sessionId) {
  const session = await getAttendanceSessionById(sessionId);
  if (!session) return null;
  const [students, records] = await Promise.all([
    listStudentsForAttendanceInstitution({
      institution: session.institution,
      institutionFilter: session.institutionFilter,
      classFilter: session.classFilter,
      registrationFilter: session.registrationFilter,
      familyStatusFilter: session.familyStatusFilter
    }),
    listAttendanceRecordsBySessionId(session.id)
  ]);
  const recordMap = new Map(records.map((record) => [record.studentId, record]));
  const rosterStudents = students.map((student) => {
    const existing = recordMap.get(student.id);
    const status = normalizeAttendanceStatus(existing?.status || "missing");
    return {
      ...student,
      status,
      noteText: clean(existing?.noteText),
      hasSavedRecord: Boolean(existing)
    };
  });
  return {
    session,
    students: rosterStudents,
    stats: buildAttendanceStats(rosterStudents, students.length)
  };
}

export function buildAttendanceStats(records, totalStudents = 0) {
  const counts = {
    totalStudents: Math.max(0, Number(totalStudents) || 0),
    filledRecords: 0,
    found: 0,
    late: 0,
    missing: 0,
    sent_home: 0
  };

  for (const record of records || []) {
    const status = normalizeAttendanceStatus(record?.status);
    counts.filledRecords += 1;
    counts[status] = (counts[status] || 0) + 1;
  }

  return counts;
}

export async function saveAttendanceRecord({ sessionId, record, markedByUserId }) {
  await initDb();
  const normalizedSessionId = clean(sessionId);
  if (!normalizedSessionId) throw new Error("Missing attendance session id.");
  const studentId = clean(record?.studentId);
  if (!studentId) throw new Error("Missing student id.");
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

  await sql`
    UPDATE attendance_sessions
    SET updated_at = NOW()
    WHERE id = ${normalizedSessionId}
  `;
}

export async function saveAttendanceRecords({ sessionId, records, markedByUserId }) {
  for (const record of records || []) {
    const studentId = clean(record?.studentId);
    if (!studentId) continue;
    await saveAttendanceRecord({ sessionId, record, markedByUserId });
  }
}

export async function deleteAttendanceSession(sessionId) {
  await initDb();
  const normalizedSessionId = clean(sessionId);
  if (!normalizedSessionId) throw new Error("Missing attendance session id.");

  await sql`
    DELETE FROM attendance_sessions
    WHERE id = ${normalizedSessionId}
  `;
}
