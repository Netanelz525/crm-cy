import { randomUUID } from "crypto";
import { HDate, months } from "@hebcal/core";
import { initDb, sql } from "./db";

function clean(value) {
  return String(value || "").trim();
}

export const STUDENT_EVENT_TYPE_OPTIONS = [
  { value: "birthday", label: "יום הולדת" },
  { value: "wedding", label: "חתונה" },
  { value: "memorial", label: "יום זיכרון" },
  { value: "other", label: "אחר" }
];

export const STUDENT_EVENT_TYPE_LABELS = Object.fromEntries(
  STUDENT_EVENT_TYPE_OPTIONS.map((option) => [option.value, option.label])
);

export const HEBREW_MONTH_OPTIONS = [
  { value: "TISHREI", label: "תשרי", monthNumber: months.TISHREI },
  { value: "CHESHVAN", label: "חשוון", monthNumber: months.CHESHVAN },
  { value: "KISLEV", label: "כסלו", monthNumber: months.KISLEV },
  { value: "TEVET", label: "טבת", monthNumber: months.TEVET },
  { value: "SHVAT", label: "שבט", monthNumber: months.SHVAT },
  { value: "ADAR_I", label: "אדר", monthNumber: months.ADAR_I },
  { value: "ADAR_II", label: "אדר ב׳", monthNumber: months.ADAR_II },
  { value: "NISAN", label: "ניסן", monthNumber: months.NISAN },
  { value: "IYYAR", label: "אייר", monthNumber: months.IYYAR },
  { value: "SIVAN", label: "סיוון", monthNumber: months.SIVAN },
  { value: "TAMUZ", label: "תמוז", monthNumber: months.TAMUZ },
  { value: "AV", label: "אב", monthNumber: months.AV },
  { value: "ELUL", label: "אלול", monthNumber: months.ELUL }
];

const HEBREW_MONTH_MAP = Object.fromEntries(
  HEBREW_MONTH_OPTIONS.map((option) => [option.value, option])
);

function normalizeEventType(value) {
  const normalized = clean(value).toLowerCase();
  return STUDENT_EVENT_TYPE_LABELS[normalized] ? normalized : "";
}

function normalizeHebrewDay(value) {
  const day = Number.parseInt(clean(value), 10);
  if (!Number.isFinite(day) || day < 1 || day > 30) return 0;
  return day;
}

function normalizeHebrewMonthCode(value) {
  const normalized = clean(value).toUpperCase();
  return HEBREW_MONTH_MAP[normalized] ? normalized : "";
}

function formatJerusalemDateInput(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function formatJerusalemDateDisplay(date) {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function dateOnlyToUtc(dateString) {
  const raw = clean(dateString);
  if (!raw) return Number.NaN;
  const [year, month, day] = raw.split("-").map((part) => Number.parseInt(part, 10));
  if (!year || !month || !day) return Number.NaN;
  return Date.UTC(year, month - 1, day);
}

function getMonthOption(monthCode) {
  return HEBREW_MONTH_MAP[normalizeHebrewMonthCode(monthCode)] || null;
}

function isValidHebrewDateForYear(day, monthOption, year) {
  const probe = new HDate(1, monthOption.monthNumber, year);
  return day <= probe.daysInMonth();
}

export function getStudentEventTypeLabel(eventType, customLabel = "") {
  const normalizedType = normalizeEventType(eventType);
  if (normalizedType === "other") return clean(customLabel) || STUDENT_EVENT_TYPE_LABELS.other;
  return STUDENT_EVENT_TYPE_LABELS[normalizedType] || clean(customLabel) || clean(eventType) || "-";
}

export function formatStudentEventHebrewDate(hebrewDay, hebrewMonthCode) {
  const day = normalizeHebrewDay(hebrewDay);
  const monthOption = getMonthOption(hebrewMonthCode);
  if (!day || !monthOption) return "-";
  return `${day} ${monthOption.label}`;
}

export function getNextStudentEventOccurrence(hebrewDay, hebrewMonthCode, fromDate = new Date()) {
  const day = normalizeHebrewDay(hebrewDay);
  const monthOption = getMonthOption(hebrewMonthCode);
  if (!day || !monthOption) return null;

  const todayDateInput = formatJerusalemDateInput(fromDate);
  const todayUtc = dateOnlyToUtc(todayDateInput);
  const currentHebrewYear = new HDate(fromDate).getFullYear();
  const candidateYears = [currentHebrewYear, currentHebrewYear + 1];

  for (const year of candidateYears) {
    if (!isValidHebrewDateForYear(day, monthOption, year)) continue;
    const gregDate = new HDate(day, monthOption.monthNumber, year).greg();
    const dateInput = formatJerusalemDateInput(gregDate);
    const candidateUtc = dateOnlyToUtc(dateInput);
    if (candidateUtc >= todayUtc) {
      return {
        hebrewYear: year,
        gregorianDate: dateInput,
        gregorianDisplay: formatJerusalemDateDisplay(gregDate),
        daysUntil: Math.round((candidateUtc - todayUtc) / 86400000)
      };
    }
  }

  return null;
}

function mapStudentEventRow(row) {
  const hebrewDay = Number(row?.hebrew_day || 0);
  const hebrewMonthCode = normalizeHebrewMonthCode(row?.hebrew_month_code);
  const customEventLabel = clean(row?.custom_event_label);
  const noteText = clean(row?.note_text);
  const eventType = normalizeEventType(row?.event_type);
  const nextOccurrence = getNextStudentEventOccurrence(hebrewDay, hebrewMonthCode);

  return {
    id: clean(row?.id),
    studentId: clean(row?.student_id),
    studentName: clean(row?.student_name),
    studentClass: clean(row?.student_class),
    currentInstitution: clean(row?.current_institution),
    eventType,
    customEventLabel,
    noteText,
    eventLabel: getStudentEventTypeLabel(eventType, customEventLabel),
    hebrewDay,
    hebrewMonthCode,
    hebrewDateLabel: formatStudentEventHebrewDate(hebrewDay, hebrewMonthCode),
    nextOccurrence,
    createdAt: row?.created_at || null,
    updatedAt: row?.updated_at || null,
    createdByUserId: clean(row?.created_by_user_id),
    createdByDisplayName: clean(row?.created_by_display_name),
    createdByEmail: clean(row?.created_by_email)
  };
}

export async function createStudentEvent({
  studentId,
  eventType,
  customEventLabel,
  noteText,
  hebrewDay,
  hebrewMonthCode,
  createdByUserId
}) {
  await initDb();
  const normalizedStudentId = clean(studentId);
  const normalizedEventType = normalizeEventType(eventType);
  const normalizedCustomLabel = clean(customEventLabel);
  const normalizedNoteText = clean(noteText);
  const normalizedHebrewDay = normalizeHebrewDay(hebrewDay);
  const normalizedHebrewMonthCode = normalizeHebrewMonthCode(hebrewMonthCode);

  if (!normalizedStudentId) throw new Error("לא נבחר תלמיד.");
  if (!normalizedEventType) throw new Error("יש לבחור סוג אירוע.");
  if (normalizedEventType === "other" && !normalizedCustomLabel) throw new Error("יש להזין סוג אירוע חופשי.");
  if (!normalizedHebrewDay) throw new Error("יש לבחור יום עברי תקין.");
  if (!normalizedHebrewMonthCode) throw new Error("יש לבחור חודש עברי.");

  const id = randomUUID();
  const rows = await sql`
    INSERT INTO student_events (
      id,
      student_id,
      event_type,
      custom_event_label,
      note_text,
      hebrew_day,
      hebrew_month_code,
      created_by_user_id,
      created_at,
      updated_at
    )
    VALUES (
      ${id},
      ${normalizedStudentId},
      ${normalizedEventType},
      ${normalizedEventType === "other" ? normalizedCustomLabel : null},
      ${normalizedNoteText || null},
      ${normalizedHebrewDay},
      ${normalizedHebrewMonthCode},
      ${clean(createdByUserId) || null},
      NOW(),
      NOW()
    )
    RETURNING id, student_id, event_type, custom_event_label, note_text, hebrew_day, hebrew_month_code, created_by_user_id, created_at, updated_at
  `;
  return mapStudentEventRow(rows[0]);
}

export async function listStudentEvents(studentId, limit = 12) {
  await initDb();
  const normalizedStudentId = clean(studentId);
  if (!normalizedStudentId) return [];

  const rows = await sql`
    SELECT
      e.id,
      e.student_id,
      e.event_type,
      e.custom_event_label,
      e.note_text,
      e.hebrew_day,
      e.hebrew_month_code,
      e.created_by_user_id,
      e.created_at,
      e.updated_at,
      u.display_name AS created_by_display_name,
      u.email AS created_by_email
    FROM student_events e
    LEFT JOIN app_users u ON u.clerk_user_id = e.created_by_user_id
    WHERE e.student_id = ${normalizedStudentId}
    ORDER BY e.hebrew_month_code ASC, e.hebrew_day ASC, e.created_at DESC
    LIMIT ${Math.max(1, Number(limit) || 12)}
  `;

  return rows
    .map(mapStudentEventRow)
    .sort((a, b) => {
      const diff = Number(a?.nextOccurrence?.daysUntil || 0) - Number(b?.nextOccurrence?.daysUntil || 0);
      if (diff !== 0) return diff;
      return String(a.eventLabel || "").localeCompare(String(b.eventLabel || ""), "he");
    });
}

export async function listUpcomingStudentEvents({ daysAhead = 45, limit = 12 } = {}) {
  await initDb();
  const rows = await sql`
    SELECT
      e.id,
      e.student_id,
      e.event_type,
      e.custom_event_label,
      e.note_text,
      e.hebrew_day,
      e.hebrew_month_code,
      e.created_by_user_id,
      e.created_at,
      e.updated_at,
      ns.full_name AS student_name,
      ns.class AS student_class,
      ns.current_institution AS current_institution,
      u.display_name AS created_by_display_name,
      u.email AS created_by_email
    FROM student_events e
    LEFT JOIN neon_students ns ON ns.student_id = e.student_id
    LEFT JOIN app_users u ON u.clerk_user_id = e.created_by_user_id
  `;

  return rows
    .map(mapStudentEventRow)
    .filter((event) => event.nextOccurrence && Number(event.nextOccurrence.daysUntil) >= 0)
    .filter((event) => Number(event.nextOccurrence.daysUntil) <= Math.max(1, Number(daysAhead) || 45))
    .sort((a, b) => {
      const dayDiff = Number(a.nextOccurrence.daysUntil) - Number(b.nextOccurrence.daysUntil);
      if (dayDiff !== 0) return dayDiff;
      return String(a.studentName || "").localeCompare(String(b.studentName || ""), "he");
    })
    .slice(0, Math.max(1, Number(limit) || 12));
}

export async function getUpcomingEventSummaryByStudentIds(studentIds, daysAhead = 365) {
  await initDb();
  const ids = (studentIds || []).map(clean).filter(Boolean);
  if (!ids.length) return {};

  const rows = await sql`
    SELECT
      e.id,
      e.student_id,
      e.event_type,
      e.custom_event_label,
      e.note_text,
      e.hebrew_day,
      e.hebrew_month_code,
      e.created_by_user_id,
      e.created_at,
      e.updated_at
    FROM student_events e
    WHERE e.student_id = ANY(${ids})
  `;

  const summaryMap = {};
  for (const row of rows) {
    const event = mapStudentEventRow(row);
    if (!event.nextOccurrence) continue;
    if (Number(event.nextOccurrence.daysUntil) > Math.max(1, Number(daysAhead) || 365)) continue;
    const studentId = clean(event.studentId);
    const current = summaryMap[studentId];
    if (!current || Number(event.nextOccurrence.daysUntil) < Number(current.nextOccurrence.daysUntil)) {
      summaryMap[studentId] = event;
    }
  }
  return summaryMap;
}

export async function attachUpcomingEventSummaryToStudents(students, daysAhead = 365) {
  const list = Array.isArray(students) ? students : [];
  if (!list.length) return list;
  const summaryMap = await getUpcomingEventSummaryByStudentIds(list.map((student) => clean(student?.id)), daysAhead);
  return list.map((student) => ({
    ...student,
    upcomingEvent: summaryMap[clean(student?.id)] || null
  }));
}
