import { ATTENDANCE_STATUS_LABELS, getAttendanceRoster } from "./attendance";
import { renderInstitutionPdf } from "./institution-pdf";

function clean(value) {
  return String(value || "").trim();
}

export const ATTENDANCE_EXPORT_SORT_LABELS = {
  class_name: "שיעור ואז משפחה",
  status: "לפי סטטוס נוכחות"
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
  const map = {
    missing: 1,
    on_the_way: 2,
    available: 3,
    found: 4
  };
  return Number(map[normalized] || 999);
}

function fileNamePart(value) {
  return clean(value)
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-")
    .slice(0, 50);
}

function buildExportRows(students, sortMode = "class_name") {
  return [...(students || [])]
    .sort((left, right) => (
      (sortMode === "status"
        ? attendanceSortValue(left.status) - attendanceSortValue(right.status)
        : classSortValue(left.class) - classSortValue(right.class))
      || classSortValue(left.class) - classSortValue(right.class)
      || clean(left.lastName).localeCompare(clean(right.lastName), "he")
      || clean(left.firstName).localeCompare(clean(right.firstName), "he")
      || clean(left.label).localeCompare(clean(right.label), "he")
    ))
    .map((student) => ({
      attendanceStatus: ATTENDANCE_STATUS_LABELS[clean(student.status).toLowerCase()] || ATTENDANCE_STATUS_LABELS.missing,
      studentClass: clean(student.classLabel) || "-",
      studentName: clean(student.label) || "-",
      noteText: clean(student.noteText) || ""
    }));
}

export async function buildAttendancePdfExport(sessionId, { sort = "class_name" } = {}) {
  const roster = await getAttendanceRoster(sessionId);
  if (!roster) {
    throw new Error("Attendance session not found.");
  }

  const sortMode = ATTENDANCE_EXPORT_SORT_LABELS[clean(sort).toLowerCase()] ? clean(sort).toLowerCase() : "class_name";
  const rows = buildExportRows(roster.students, sortMode);
  const title = [
    "דוח נוכחות",
    clean(roster.session.institutionLabel),
    clean(roster.session.sessionTypeLabel || roster.session.title)
  ].filter(Boolean).join(" - ");
  const subtitle = `מיון: ${ATTENDANCE_EXPORT_SORT_LABELS[sortMode]} | תאריך: ${clean(roster.session.sessionDate) || "-"}`;

  const pdf = await renderInstitutionPdf({
    title,
    subtitle,
    orientation: "portrait",
    columns: [
      { key: "studentName", label: "שם תלמיד" },
      { key: "studentClass", label: "שיעור" },
      { key: "attendanceStatus", label: "סטטוס נוכחות" },
      { key: "noteText", label: "הערה" }
    ],
    rows
  });

  const baseName = [
    "attendance",
    fileNamePart(roster.session.institutionLabel),
    fileNamePart(roster.session.sessionTypeLabel || roster.session.title),
    clean(roster.session.sessionDate)
  ].filter(Boolean).join("-");

  return {
    content: pdf,
    filename: `${baseName || "attendance-report"}.pdf`,
    contentType: "application/pdf"
  };
}
