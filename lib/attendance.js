import { initDb, sql } from "./db";
import { listNeonStudentsByFilters } from "./neon-students";
import { ENUM_LABELS } from "./student-fields";
import { CLASS_LABELS, CLASS_ORDER, getLastName, INSTITUTIONS } from "./student-view";

export const ATTENDANCE_STATUS_LABELS = {
  found: "נמצא",
  missing: "לא נמצא",
  available: "זמין",
  on_the_way: "בדרך",
  unavailable: "לא זמין"
};

export const ATTENDANCE_EMAIL_RECIPIENT_LABELS = {
  student: "תלמיד",
  father: "אב",
  mother: "אם"
};

export const DEFAULT_ATTENDANCE_EMAIL_RECIPIENT_ROLES = ["father", "mother", "student"];

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

const ATTENDANCE_CUSTOM_STATUS_API_NAME_RE = /^[a-z][a-z0-9_]*$/;

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

function normalizeCustomStatusApiName(value) {
  const raw = clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return ATTENDANCE_CUSTOM_STATUS_API_NAME_RE.test(raw) ? raw : "";
}

function normalizeAttendanceCustomStatuses(values) {
  const raw = Array.isArray(values) ? values : [];
  const seen = new Set();
  const statuses = [];
  for (const item of raw) {
    const value = normalizeCustomStatusApiName(item?.value || item?.apiName || item?.api_name);
    const label = clean(item?.label || item?.displayName || item?.display_name);
    if (!value || !label || ATTENDANCE_STATUS_LABELS[value] || seen.has(value)) continue;
    seen.add(value);
    statuses.push({ value, label });
  }
  return statuses;
}

export function parseAttendanceCustomStatusesText(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [apiName, ...labelParts] = line.split("|");
      return {
        value: clean(apiName),
        label: clean(labelParts.join("|"))
      };
    });
}

export function buildAttendanceStatusLabels(customStatuses = []) {
  return {
    ...ATTENDANCE_STATUS_LABELS,
    ...Object.fromEntries(normalizeAttendanceCustomStatuses(customStatuses).map((item) => [item.value, item.label]))
  };
}

function mapFilterOptions(values, options = {}) {
  return normalizeCodeList(values, options).map((value) => ({
    value,
    label: options[value] || value
  }));
}

function mapExactValueOptions(values, labels = {}) {
  return unique((Array.isArray(values) ? values : [values]).map((value) => clean(value)).filter(Boolean))
    .map((value) => ({
      value,
      label: labels[value] || value
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

function normalizeAttendanceStatusFilters(values, customStatuses = []) {
  const labels = buildAttendanceStatusLabels(customStatuses);
  return unique((Array.isArray(values) ? values : [values])
    .map((value) => normalizeAttendanceStatus(value))
    .filter((value) => labels[value]));
}

function normalizeAttendanceEmailRecipientRoles(values) {
  return unique((Array.isArray(values) ? values : [values])
    .map((value) => clean(value).toLowerCase())
    .filter((value) => ATTENDANCE_EMAIL_RECIPIENT_LABELS[value]));
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
  if (raw === "left_early") return "available";
  if (raw === "late") return "on_the_way";
  if (raw === "sent_home") return "available";
  if (ATTENDANCE_STATUS_LABELS[raw]) return raw;
  return normalizeCustomStatusApiName(raw) || "missing";
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
  const tagFilter = unique((Array.isArray(row?.tag_filter) ? row.tag_filter : [row?.tag_filter]).map(clean).filter(Boolean));
  return {
    institutionFilter,
    institutionFilterOptions: mapFilterOptions(institutionFilter, INSTITUTIONS),
    classFilter,
    classFilterOptions: mapFilterOptions(classFilter, CLASS_LABELS),
    registrationFilter,
    registrationFilterOptions: mapFilterOptions(registrationFilter, ENUM_LABELS.registration || {}),
    familyStatusFilter,
    familyStatusFilterOptions: mapFilterOptions(familyStatusFilter, ENUM_LABELS.familystatus || {}),
    tagFilter
  };
}

function isAttendedStatus(status) {
  const normalized = normalizeAttendanceStatus(status);
  return normalized === "found" || normalized === "available" || normalized === "on_the_way";
}

function classSortValue(classCode) {
  const key = clean(classCode).toUpperCase();
  return Number(CLASS_ORDER?.[key] || 999);
}

function mapSessionRow(row) {
  if (!row) return null;
  const institution = normalizeInstitution(row.institution);
  const sessionType = normalizeAttendanceSessionType(row.session_type);
  const storedTitle = clean(row.title);
  const sessionTypeLabel = ATTENDANCE_SESSION_TYPE_LABELS[sessionType] || storedTitle;
  const filters = mapSessionFilters(row);
  const sessionDate = normalizeSessionDate(row.session_date);
  const emailRecipientRoles = normalizeAttendanceEmailRecipientRoles(row.email_recipient_roles);
  const customStatuses = normalizeAttendanceCustomStatuses(row.custom_statuses);
  const statusLabels = buildAttendanceStatusLabels(customStatuses);
  const displayTitle = storedTitle || sessionTypeLabel || "מפגש נוכחות";
  return {
    id: clean(row.id),
    institution,
    institutionLabel: INSTITUTIONS[institution] || institution || "-",
    title: storedTitle,
    displayTitle,
    sessionType,
    sessionTypeLabel,
    sessionDate,
    sessionWeekdayLabel: formatWeekday(sessionDate),
    sessionHebrewDateLabel: formatHebrewDate(sessionDate),
    sourceNote: clean(row.source_note),
    emailSubject: clean(row.email_subject),
    personalMessage: clean(row.personal_message),
    customStatuses,
    statusOptions: Object.entries(statusLabels),
    emailResponseStatuses: normalizeAttendanceStatusFilters(row.email_response_statuses, customStatuses),
    emailResponseStatusOptions: mapExactValueOptions(normalizeAttendanceStatusFilters(row.email_response_statuses, customStatuses), statusLabels),
    emailRecipientRoles: emailRecipientRoles.length ? emailRecipientRoles : DEFAULT_ATTENDANCE_EMAIL_RECIPIENT_ROLES,
    emailRecipientRoleOptions: mapExactValueOptions(emailRecipientRoles.length ? emailRecipientRoles : DEFAULT_ATTENDANCE_EMAIL_RECIPIENT_ROLES, ATTENDANCE_EMAIL_RECIPIENT_LABELS),
    institutionFilter: filters.institutionFilter,
    institutionFilterOptions: filters.institutionFilterOptions,
    classFilter: filters.classFilter,
    classFilterOptions: filters.classFilterOptions,
    registrationFilter: filters.registrationFilter,
    registrationFilterOptions: filters.registrationFilterOptions,
    familyStatusFilter: filters.familyStatusFilter,
    familyStatusFilterOptions: filters.familyStatusFilterOptions,
    tagFilter: filters.tagFilter,
    tagFilterOptions: Array.isArray(row.tag_filter_options) ? row.tag_filter_options : [],
    visibleToStudents: row.visible_to_students === true,
    responsibleUserId: clean(row.responsible_user_id),
    responsibleDisplayName: clean(row.responsible_display_name) || clean(row.responsible_email) || clean(row.responsible_user_id),
    responsibleEmail: clean(row.responsible_email),
    isLocked: row.is_locked === true,
    lockedAt: row.locked_at || null,
    lockedByUserId: clean(row.locked_by_user_id),
    lockedByDisplayName: clean(row.locked_by_display_name) || clean(row.locked_by_user_id) || "",
    createdByUserId: clean(row.created_by_user_id),
    createdByDisplayName: clean(row.created_by_display_name) || clean(row.created_by_user_id) || "לא ידוע",
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

function mapRecordRow(row, statusLabels = ATTENDANCE_STATUS_LABELS) {
  if (!row) return null;
  const status = normalizeAttendanceStatus(row.status);
  return {
    sessionId: clean(row.session_id),
    studentId: clean(row.student_id),
    studentName: clean(row.student_name),
    studentClass: clean(row.student_class),
    studentClassLabel: CLASS_LABELS[clean(row.student_class).toUpperCase()] || clean(row.student_class) || "-",
    status,
    statusLabel: statusLabels[status] || ATTENDANCE_STATUS_LABELS[status] || status,
    noteText: clean(row.note_text),
    markedByUserId: clean(row.marked_by_user_id),
    markedAt: row.marked_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

async function resolveMarkedByUserId(value) {
  const normalizedUserId = clean(value);
  if (!normalizedUserId) return null;
  const rows = await sql`
    SELECT clerk_user_id
    FROM app_users
    WHERE clerk_user_id = ${normalizedUserId}
    LIMIT 1
  `;
  return clean(rows?.[0]?.clerk_user_id) || null;
}

export async function createAttendanceSession({
  id,
  institution,
  sessionType,
  title,
  sessionDate,
  sourceNote,
  emailSubject = "",
  personalMessage = "",
  emailResponseStatuses = [],
  emailRecipientRoles = DEFAULT_ATTENDANCE_EMAIL_RECIPIENT_ROLES,
  customStatuses = [],
  institutionFilter = [],
  classFilter = [],
  registrationFilter = [],
  familyStatusFilter = [],
  tagFilter = [],
  responsibleUserId = "",
  visibleToStudents = false,
  createdByUserId
}) {
  await initDb();
  const sessionId = clean(id);
  const institutionCode = normalizeInstitution(institution);
  const normalizedSessionType = normalizeAttendanceSessionType(sessionType);
  const normalizedDate = normalizeSessionDate(sessionDate);
  const normalizedEmailRecipientRoles = normalizeAttendanceEmailRecipientRoles(emailRecipientRoles);
  const normalizedCustomStatuses = normalizeAttendanceCustomStatuses(customStatuses);
  const normalizedEmailResponseStatuses = normalizeAttendanceStatusFilters(emailResponseStatuses, normalizedCustomStatuses);
  const normalizedInstitutionFilter = normalizeInstitutionFilters(institutionFilter);
  const normalizedClassFilter = normalizeClassFilters(classFilter);
  const normalizedRegistrationFilter = normalizeRegistrationFilters(registrationFilter);
  const normalizedFamilyStatusFilter = normalizeFamilyStatusFilters(familyStatusFilter);
  const normalizedTagFilter = unique((Array.isArray(tagFilter) ? tagFilter : [tagFilter]).map(clean).filter(Boolean));
  const normalizedResponsibleUserId = clean(responsibleUserId) || null;
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
      email_subject,
      personal_message,
      custom_statuses,
      email_response_statuses,
      email_recipient_roles,
      institution_filter,
      class_filter,
      registration_filter,
      family_status_filter,
      tag_filter,
      responsible_user_id,
      visible_to_students,
      is_locked,
      locked_at,
      locked_by_user_id,
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
      ${clean(emailSubject)},
      ${clean(personalMessage)},
      ${JSON.stringify(normalizedCustomStatuses)}::jsonb,
      ${normalizedEmailResponseStatuses},
      ${normalizedEmailRecipientRoles},
      ${normalizedInstitutionFilter},
      ${normalizedClassFilter},
      ${normalizedRegistrationFilter},
      ${normalizedFamilyStatusFilter},
      ${normalizedTagFilter},
      ${normalizedResponsibleUserId},
      ${Boolean(visibleToStudents)},
      FALSE,
      NULL,
      NULL,
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
      s.email_subject,
      s.personal_message,
      s.custom_statuses,
      s.email_response_statuses,
      s.email_recipient_roles,
      s.institution_filter,
      s.class_filter,
      s.registration_filter,
      s.family_status_filter,
      s.tag_filter,
      s.responsible_user_id,
      s.visible_to_students,
      s.is_locked,
      s.locked_at,
      s.locked_by_user_id,
      s.created_by_user_id,
      s.created_at,
      s.updated_at,
      u.display_name AS created_by_display_name,
      lu.display_name AS locked_by_display_name,
      ru.display_name AS responsible_display_name,
      ru.email AS responsible_email,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object('value', t.id, 'label', t.name) ORDER BY t.name)
        FROM student_tags t
        WHERE t.id = ANY(COALESCE(s.tag_filter, ARRAY[]::TEXT[]))
      ), '[]'::jsonb) AS tag_filter_options
    FROM attendance_sessions s
    LEFT JOIN app_users u
      ON u.clerk_user_id = s.created_by_user_id
    LEFT JOIN app_users lu
      ON lu.clerk_user_id = s.locked_by_user_id
    LEFT JOIN app_users ru
      ON ru.clerk_user_id = s.responsible_user_id
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
  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 12));
  const rows = await sql(
    `
      SELECT
        s.id,
        s.institution,
        s.session_type,
        s.title,
        s.session_date,
        s.source_note,
        s.email_subject,
        s.personal_message,
        s.custom_statuses,
        s.email_response_statuses,
        s.email_recipient_roles,
        s.institution_filter,
        s.class_filter,
        s.registration_filter,
        s.family_status_filter,
        s.tag_filter,
        s.responsible_user_id,
        s.visible_to_students,
        s.is_locked,
        s.locked_at,
        s.locked_by_user_id,
        s.created_by_user_id,
        s.created_at,
        s.updated_at,
        u.display_name AS created_by_display_name,
        lu.display_name AS locked_by_display_name,
        ru.display_name AS responsible_display_name,
        ru.email AS responsible_email,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object('value', t.id, 'label', t.name) ORDER BY t.name)
          FROM student_tags t
          WHERE t.id = ANY(COALESCE(s.tag_filter, ARRAY[]::TEXT[]))
        ), '[]'::jsonb) AS tag_filter_options
      FROM attendance_sessions s
      LEFT JOIN app_users u
        ON u.clerk_user_id = s.created_by_user_id
      LEFT JOIN app_users lu
        ON lu.clerk_user_id = s.locked_by_user_id
      LEFT JOIN app_users ru
        ON ru.clerk_user_id = s.responsible_user_id
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

export async function listAttendanceResponsibleUsers() {
  await initDb();
  const rows = await sql`
    SELECT clerk_user_id, display_name, email, role, linked_student_class
    FROM app_users
    WHERE access_status = 'approved'
      AND (
        LOWER(COALESCE(role, '')) IN ('editor', 'admin', 'super_admin')
        OR UPPER(COALESCE(linked_student_class, '')) = 'TEAM'
      )
    ORDER BY display_name ASC, email ASC
  `;
  return rows.map((row) => ({
    id: clean(row.clerk_user_id),
    displayName: clean(row.display_name) || clean(row.email) || clean(row.clerk_user_id),
    email: clean(row.email),
    role: clean(row.role),
    linkedStudentClass: clean(row.linked_student_class)
  })).filter((user) => user.id);
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
  const tagFilter = typeof input === "object"
    ? unique((Array.isArray(input?.tagFilter) ? input.tagFilter : [input?.tagFilter]).map(clean).filter(Boolean))
    : [];
  let students = await listNeonStudentsByFilters({
    institution: institutionFilter.length ? institutionFilter : (institutionCode && institutionCode !== "ALL" ? [institutionCode] : []),
    class: classFilter,
    registration: registrationFilter,
    famliystatus: familyStatusFilter
  });
  if (tagFilter.length) {
    const rows = await sql`
      SELECT DISTINCT student_id
      FROM student_tag_assignments
      WHERE tag_id = ANY(${tagFilter})
    `;
    const allowedStudentIds = new Set(rows.map((row) => clean(row.student_id)).filter(Boolean));
    students = students.filter((student) => allowedStudentIds.has(clean(student?.id)));
  }
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
  const session = await getAttendanceSessionById(sessionId);
  const statusLabels = buildAttendanceStatusLabels(session?.customStatuses || []);
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
  return rows.map((row) => mapRecordRow(row, statusLabels)).filter(Boolean);
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
        s.session_date,
        s.custom_statuses
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
    const statusLabels = buildAttendanceStatusLabels(row.custom_statuses);
    const record = mapRecordRow(row, statusLabels);
    const institution = normalizeInstitution(row.institution);
    return {
      ...record,
      institution,
      institutionLabel: INSTITUTIONS[institution] || institution || "-",
      sessionType: normalizeAttendanceSessionType(row.session_type),
      sessionTitle: clean(row.title) || ATTENDANCE_SESSION_TYPE_LABELS[normalizeAttendanceSessionType(row.session_type)] || "מפגש נוכחות",
      sessionDate: normalizeSessionDate(row.session_date)
    };
  }).filter(Boolean);
}

export async function listOpenAttendanceSessionsForStudent(studentId, { limit = 8, scanLimit = 120 } = {}) {
  await initDb();
  const normalizedStudentId = clean(studentId);
  if (!normalizedStudentId) return [];
  const safeLimit = Math.max(1, Math.min(20, Number(limit) || 8));
  const safeScanLimit = Math.max(safeLimit, Math.min(300, Number(scanLimit) || 120));
  const sessions = await listAttendanceSessions({ limit: safeScanLimit });
  const openSessions = [];

  for (const session of sessions) {
    if (session.isLocked) continue;
    if (!session.visibleToStudents) continue;
    const roster = await getAttendanceRoster(session.id);
    const student = roster?.students?.find((item) => clean(item.id) === normalizedStudentId);
    if (!student) continue;
    openSessions.push({
      session: roster.session,
      student
    });
    if (openSessions.length >= safeLimit) break;
  }

  return openSessions;
}

export async function saveOpenAttendanceRecordForStudent({ sessionId, studentId, status, noteText, markedByUserId }) {
  await initDb();
  const normalizedSessionId = clean(sessionId);
  const normalizedStudentId = clean(studentId);
  if (!normalizedSessionId) throw new Error("Missing attendance session id.");
  if (!normalizedStudentId) throw new Error("Missing student id.");
  const roster = await getAttendanceRoster(normalizedSessionId);
  if (!roster) throw new Error("Attendance session not found.");
  if (roster.session.isLocked) throw new Error("המפגש נעול. מנהל צריך לפתוח את הנעילה לפני עדכון סטטוסים.");
  if (!roster.session.visibleToStudents) throw new Error("המפגש לא גלוי לעדכון תלמידים.");
  const student = roster.students.find((item) => clean(item.id) === normalizedStudentId);
  if (!student) throw new Error("המפגש לא פתוח לתלמיד הזה.");

  await saveAttendanceRecord({
    sessionId: normalizedSessionId,
    record: {
      studentId: student.id,
      studentName: student.label,
      studentClass: student.class,
      status,
      noteText
    },
    markedByUserId
  });
}

export async function getAttendanceSummaryForStudent(studentId) {
  await initDb();
  const normalizedStudentId = clean(studentId);
  if (!normalizedStudentId) {
    return {
      totalSessions: 0,
      attendedSessions: 0,
      found: 0,
      available: 0,
      missing: 0,
      onTheWay: 0,
      unavailable: 0,
      attendancePercent: 0
    };
  }

  const rows = await sql`
    SELECT
      COUNT(*)::int AS total_sessions,
      COUNT(*) FILTER (WHERE status = 'found')::int AS found_count,
      COUNT(*) FILTER (WHERE status = 'available')::int AS available_count,
      COUNT(*) FILTER (WHERE status = 'missing')::int AS missing_count,
      COUNT(*) FILTER (WHERE status = 'on_the_way')::int AS on_the_way_count,
      COUNT(*) FILTER (WHERE status = 'unavailable')::int AS unavailable_count
    FROM attendance_records
    WHERE student_id = ${normalizedStudentId}
  `;

  const row = rows[0] || {};
  const totalSessions = Number(row.total_sessions || 0);
  const found = Number(row.found_count || 0);
  const available = Number(row.available_count || 0);
  const missing = Number(row.missing_count || 0);
  const onTheWay = Number(row.on_the_way_count || 0);
  const unavailable = Number(row.unavailable_count || 0);
  const attendedSessions = found + available + onTheWay;
  const attendancePercent = totalSessions
    ? Math.round((attendedSessions / totalSessions) * 1000) / 10
    : 0;

  return {
    totalSessions,
    attendedSessions,
    found,
    available,
    missing,
    onTheWay,
    unavailable,
    attendancePercent
  };
}

export async function getAttendanceRoster(sessionId) {
  const session = await getAttendanceSessionById(sessionId);
  if (!session) return null;
  const statusLabels = buildAttendanceStatusLabels(session.customStatuses);
  const [students, records] = await Promise.all([
    listStudentsForAttendanceInstitution({
      institution: session.institution,
      institutionFilter: session.institutionFilter,
      classFilter: session.classFilter,
      registrationFilter: session.registrationFilter,
      familyStatusFilter: session.familyStatusFilter,
      tagFilter: session.tagFilter
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
      statusLabel: statusLabels[status] || status,
      noteText: clean(existing?.noteText),
      hasSavedRecord: Boolean(existing)
    };
  });
  return {
    session,
    students: rosterStudents,
    stats: buildAttendanceStats(rosterStudents, students.length, statusLabels)
  };
}

export async function listTodayAttendanceSessionsForAgent({ date = "" } = {}) {
  const targetDate = normalizeSessionDate(date) || new Date().toISOString().slice(0, 10);
  const sessions = await listAttendanceSessions({
    dateFrom: targetDate,
    dateTo: targetDate,
    limit: 24
  });

  const items = [];
  for (const session of sessions) {
    const roster = await getAttendanceRoster(session.id);
    if (!roster) continue;

    const recentFoundRows = await sql`
      SELECT student_name
      FROM attendance_records
      WHERE session_id = ${session.id}
        AND status = 'found'
        AND updated_at::date = ${targetDate}::date
      ORDER BY updated_at DESC
      LIMIT 8
    `;

    const totalStudents = Number(roster.stats?.totalStudents || roster.students.length || 0);
    const foundCount = Number(roster.stats?.found || 0);
    const missingCount = Number(roster.stats?.missing || 0);
    const missingPercent = totalStudents
      ? Math.round((missingCount / totalStudents) * 100)
      : 0;

    items.push({
      id: session.id,
      title: session.displayTitle || session.title || session.sessionTypeLabel || "מפגש נוכחות",
      sessionTypeLabel: session.sessionTypeLabel || "",
      sessionDate: session.sessionDate,
      institutionLabel: session.institutionLabel,
      foundCount,
      totalStudents,
      missingCount,
      missingPercent,
      recentFoundNames: recentFoundRows.map((row) => clean(row.student_name)).filter(Boolean),
      sessionUrl: `/attendance/${encodeURIComponent(session.id)}`,
      pdfUrls: {
        className: `/api/attendance/${encodeURIComponent(session.id)}/pdf?sort=class_name`,
        status: `/api/attendance/${encodeURIComponent(session.id)}/pdf?sort=status`
      }
    });
  }

  return items;
}

export function buildAttendanceStats(records, totalStudents = 0, statusLabels = ATTENDANCE_STATUS_LABELS) {
  const counts = {
    totalStudents: Math.max(0, Number(totalStudents) || 0),
    filledRecords: 0,
    found: 0,
    available: 0,
    missing: 0,
    on_the_way: 0,
    unavailable: 0,
    customStatuses: []
  };
  const customCounts = new Map();

  for (const record of records || []) {
    const status = normalizeAttendanceStatus(record?.status);
    counts.filledRecords += 1;
    if (Object.prototype.hasOwnProperty.call(counts, status)) {
      counts[status] = (counts[status] || 0) + 1;
    } else {
      customCounts.set(status, (customCounts.get(status) || 0) + 1);
    }
  }

  counts.customStatuses = Array.from(customCounts.entries()).map(([value, count]) => ({
    value,
    label: statusLabels[value] || value,
    count
  }));

  return counts;
}

export async function syncAttendanceSessionStudents(sessionId) {
  await initDb();
  const session = await getAttendanceSessionById(sessionId);
  if (!session) throw new Error("Attendance session not found.");

  const students = await listStudentsForAttendanceInstitution({
    institution: session.institution,
    institutionFilter: session.institutionFilter,
    classFilter: session.classFilter,
    registrationFilter: session.registrationFilter,
    familyStatusFilter: session.familyStatusFilter,
    tagFilter: session.tagFilter
  });
  const studentIds = unique(students.map((student) => clean(student.id)));

  if (studentIds.length) {
    await sql`
      DELETE FROM attendance_records
      WHERE session_id = ${session.id}
        AND NOT (student_id = ANY(${studentIds}))
    `;
  } else {
    await sql`
      DELETE FROM attendance_records
      WHERE session_id = ${session.id}
    `;
  }

  await sql`
    UPDATE attendance_sessions
    SET updated_at = NOW()
    WHERE id = ${session.id}
  `;

  return getAttendanceRoster(session.id);
}

export async function updateAttendanceSessionMessaging(sessionId, {
  emailSubject = "",
  personalMessage = "",
  emailResponseStatuses = [],
  emailRecipientRoles = DEFAULT_ATTENDANCE_EMAIL_RECIPIENT_ROLES
} = {}) {
  await initDb();
  const normalizedSessionId = clean(sessionId);
  if (!normalizedSessionId) throw new Error("Missing attendance session id.");
  const current = await getAttendanceSessionById(normalizedSessionId);
  const currentCustomStatuses = current?.customStatuses || [];

  await sql`
    UPDATE attendance_sessions
    SET
      email_subject = ${clean(emailSubject)},
      personal_message = ${clean(personalMessage)},
      email_response_statuses = ${normalizeAttendanceStatusFilters(emailResponseStatuses, currentCustomStatuses)},
      email_recipient_roles = ${normalizeAttendanceEmailRecipientRoles(emailRecipientRoles)},
      updated_at = NOW()
    WHERE id = ${normalizedSessionId}
  `;

  return getAttendanceSessionById(normalizedSessionId);
}

export async function updateAttendanceSessionDetails(sessionId, {
  title,
  sourceNote,
  sessionType,
  sessionDate,
  responsibleUserId,
  visibleToStudents,
  tagFilter
} = {}) {
  await initDb();
  const normalizedSessionId = clean(sessionId);
  if (!normalizedSessionId) throw new Error("Missing attendance session id.");
  const current = await getAttendanceSessionById(normalizedSessionId);
  if (!current) throw new Error("Attendance session not found.");

  const nextSessionType = sessionType === undefined
    ? current.sessionType
    : normalizeAttendanceSessionType(sessionType);
  if (!nextSessionType) throw new Error("בחר סוג מפגש תקין.");

  const nextSessionDate = sessionDate === undefined
    ? current.sessionDate
    : normalizeSessionDate(sessionDate);
  if (!nextSessionDate) throw new Error("בחר תאריך תקין למפגש.");

  const nextTitle = title === undefined ? current.title : clean(title);
  const nextSourceNote = sourceNote === undefined ? current.sourceNote : clean(sourceNote);
  const nextResponsibleUserId = responsibleUserId === undefined
    ? current.responsibleUserId || null
    : clean(responsibleUserId) || null;
  const nextVisibleToStudents = visibleToStudents === undefined
    ? Boolean(current.visibleToStudents)
    : Boolean(visibleToStudents);
  const nextTagFilter = tagFilter === undefined
    ? current.tagFilter || []
    : unique((Array.isArray(tagFilter) ? tagFilter : [tagFilter]).map(clean).filter(Boolean));

  await sql`
    UPDATE attendance_sessions
    SET
      title = ${nextTitle || ATTENDANCE_SESSION_TYPE_LABELS[nextSessionType]},
      source_note = ${nextSourceNote},
      session_type = ${nextSessionType},
      session_date = ${nextSessionDate},
      responsible_user_id = ${nextResponsibleUserId},
      visible_to_students = ${nextVisibleToStudents},
      tag_filter = ${nextTagFilter},
      updated_at = NOW()
    WHERE id = ${normalizedSessionId}
  `;

  return getAttendanceSessionById(normalizedSessionId);
}

export async function updateAttendanceSessionCustomStatuses(sessionId, { customStatuses = [] } = {}) {
  await initDb();
  const normalizedSessionId = clean(sessionId);
  if (!normalizedSessionId) throw new Error("Missing attendance session id.");
  const normalizedCustomStatuses = normalizeAttendanceCustomStatuses(customStatuses);
  const current = await getAttendanceSessionById(normalizedSessionId);
  if (!current) throw new Error("Attendance session not found.");

  await sql`
    UPDATE attendance_sessions
    SET
      custom_statuses = ${JSON.stringify(normalizedCustomStatuses)}::jsonb,
      email_response_statuses = ${normalizeAttendanceStatusFilters(current.emailResponseStatuses, normalizedCustomStatuses)},
      updated_at = NOW()
    WHERE id = ${normalizedSessionId}
  `;

  return getAttendanceSessionById(normalizedSessionId);
}

export async function setAttendanceSessionLocked(sessionId, { locked = false, lockedByUserId = "" } = {}) {
  await initDb();
  const normalizedSessionId = clean(sessionId);
  if (!normalizedSessionId) throw new Error("Missing attendance session id.");
  const current = await getAttendanceSessionById(normalizedSessionId);
  if (!current) throw new Error("Attendance session not found.");
  const shouldLock = Boolean(locked);
  const validLockedByUserId = shouldLock ? await resolveMarkedByUserId(lockedByUserId) : null;

  await sql`
    UPDATE attendance_sessions
    SET
      is_locked = ${shouldLock},
      locked_at = ${shouldLock ? new Date() : null},
      locked_by_user_id = ${validLockedByUserId},
      updated_at = NOW()
    WHERE id = ${normalizedSessionId}
  `;

  return getAttendanceSessionById(normalizedSessionId);
}

export async function saveAttendanceRecord({ sessionId, record, markedByUserId }) {
  await initDb();
  const normalizedSessionId = clean(sessionId);
  if (!normalizedSessionId) throw new Error("Missing attendance session id.");
  const session = await getAttendanceSessionById(normalizedSessionId);
  if (!session) throw new Error("Attendance session not found.");
  if (session.isLocked) throw new Error("המפגש נעול. מנהל צריך לפתוח את הנעילה לפני עדכון סטטוסים.");
  const studentId = clean(record?.studentId);
  if (!studentId) throw new Error("Missing student id.");
  const status = normalizeAttendanceStatus(record?.status);
  const studentName = clean(record?.studentName) || "ללא שם";
  const studentClass = clean(record?.studentClass).toUpperCase();
  const noteText = clean(record?.noteText);
  const validMarkedByUserId = await resolveMarkedByUserId(markedByUserId);

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
      ${validMarkedByUserId},
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
