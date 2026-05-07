import { ATTENDANCE_STATUS_LABELS, getAttendanceRoster } from "./attendance";
import { renderInstitutionPdf } from "./institution-pdf";

function clean(value) {
  return String(value || "").trim();
}

const ATTENDANCE_STATUS_ORDER = {
  absent: 1,
  excused: 2,
  late: 3,
  left_early: 4,
  present: 5
};

function classSortValue(classCode) {
  const normalized = clean(classCode).toUpperCase();
  const map = {
    A: 1,
    B: 2,
    C: 3,
    D: 4,
    E: 5,
    X: 6,
    Z: 7,
    TEAM: 8
  };
  return Number(map[normalized] || 999);
}

function attendanceSortValue(status) {
  const normalized = clean(status).toLowerCase();
  return Number(ATTENDANCE_STATUS_ORDER[normalized] || 999);
}

function fileNamePart(value) {
  return clean(value)
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-")
    .slice(0, 50);
}

function buildExportRows(students) {
  return [...(students || [])]
    .sort((left, right) => (
      attendanceSortValue(left.status) - attendanceSortValue(right.status)
      || classSortValue(left.class) - classSortValue(right.class)
      || clean(left.lastName).localeCompare(clean(right.lastName), "he")
      || clean(left.firstName).localeCompare(clean(right.firstName), "he")
      || clean(left.label).localeCompare(clean(right.label), "he")
    ))
    .map((student, index) => ({
      rowNumber: String(index + 1),
      attendanceStatus: ATTENDANCE_STATUS_LABELS[clean(student.status).toLowerCase()] || ATTENDANCE_STATUS_LABELS.absent,
      studentClass: clean(student.classLabel) || "-",
      studentName: clean(student.label) || "-",
      noteText: clean(student.noteText) || ""
    }));
}

export async function buildAttendancePdfExport(sessionId) {
  const roster = await getAttendanceRoster(sessionId);
  if (!roster) {
    throw new Error("Attendance session not found.");
  }

  const rows = buildExportRows(roster.students);
  const title = [
    "דוח נוכחות",
    clean(roster.session.institutionLabel),
    clean(roster.session.title)
  ].filter(Boolean).join(" - ");
  const subtitle = `ממויין לפי סטטוס נוכחות ולאחר מכן לפי שיעור | תאריך: ${clean(roster.session.sessionDate) || "-"}`;

  const pdf = await renderInstitutionPdf({
    title,
    subtitle,
    orientation: "portrait",
    columns: [
      { key: "rowNumber", label: "#", kind: "rowNumber" },
      { key: "attendanceStatus", label: "סטטוס נוכחות" },
      { key: "studentClass", label: "שיעור" },
      { key: "studentName", label: "שם תלמיד" },
      { key: "noteText", label: "הערה" }
    ],
    rows
  });

  const baseName = [
    "attendance",
    fileNamePart(roster.session.institutionLabel),
    fileNamePart(roster.session.title),
    clean(roster.session.sessionDate)
  ].filter(Boolean).join("-");

  return {
    content: pdf,
    filename: `${baseName || "attendance-report"}.pdf`,
    contentType: "application/pdf"
  };
}
