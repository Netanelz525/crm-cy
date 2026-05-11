import * as XLSX from "xlsx";
import {
  ATTENDANCE_SESSION_TYPE_LABELS,
  ATTENDANCE_SESSION_TYPE_ORDER,
  getAttendanceSummaryReport
} from "./attendance";
import { renderInstitutionPdf } from "./institution-pdf";

function clean(value) {
  return String(value || "").trim();
}

function formatPercent(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return "0%";
  return `${numeric % 1 === 0 ? numeric.toFixed(0) : numeric.toFixed(1)}%`;
}

export const ATTENDANCE_SUMMARY_SORT_LABELS = {
  class_name: "שיעור ושם משפחה",
  absence_rate: "אחוז היעדרות"
};

function parseSearchParams(input) {
  const searchParams = input instanceof URLSearchParams
    ? input
    : new URL(String(input), "https://internal.local").searchParams;

  return {
    institution: clean(searchParams.get("reportInstitution")),
    dateFrom: clean(searchParams.get("reportStart")),
    dateTo: clean(searchParams.get("reportEnd")),
    sort: clean(searchParams.get("reportSort")).toLowerCase() || "class_name"
  };
}

function sanitizeFilenamePart(value) {
  return clean(value)
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildFileName(report, extension) {
  const scope = sanitizeFilenamePart(report?.institutionLabel || report?.institution || "attendance-summary");
  return `סיכום נוכחות - ${scope} - ${clean(report?.dateFrom)} עד ${clean(report?.dateTo)}.${extension}`;
}

function buildSortedStudents(report, sortMode = "class_name") {
  return [...(report?.rows || [])].sort((left, right) => (
    (sortMode === "absence_rate"
      ? Number(left.overall?.percent ?? 0) - Number(right.overall?.percent ?? 0)
      : 0)
    || String(left.class || "").localeCompare(String(right.class || ""), "he")
    || clean(left.lastName).localeCompare(clean(right.lastName), "he")
    || clean(left.firstName).localeCompare(clean(right.firstName), "he")
    || clean(left.label).localeCompare(clean(right.label), "he")
  ));
}

function buildSummaryRows(report, sortMode = "class_name") {
  return buildSortedStudents(report, sortMode).map((student) => {
    const row = {
      "שם תלמיד": student.label,
      "שיעור": student.classLabel
    };

    for (const sessionType of ATTENDANCE_SESSION_TYPE_ORDER) {
      const label = ATTENDANCE_SESSION_TYPE_LABELS[sessionType];
      row[label] = `${student.byType[sessionType].displayValue} | ${formatPercent(student.byType[sessionType].percent)}`;
    }

    row["אחוז מסכם"] = `${student.overall.displayValue} | ${formatPercent(student.overall.percent)}`;
    return row;
  });
}

async function requireSummaryReport(input) {
  const request = parseSearchParams(input);
  const report = await getAttendanceSummaryReport(request);
  if (!report) {
    throw new Error("Missing summary report filters.");
  }
  return {
    report,
    sortMode: ATTENDANCE_SUMMARY_SORT_LABELS[request.sort] ? request.sort : "class_name"
  };
}

export async function buildAttendanceSummaryExcelExport(input) {
  const { report, sortMode } = await requireSummaryReport(input);
  const rows = buildSummaryRows(report, sortMode);
  const header = ["שם תלמיד", "שיעור", ...ATTENDANCE_SESSION_TYPE_ORDER.map((sessionType) => ATTENDANCE_SESSION_TYPE_LABELS[sessionType]), "אחוז מסכם"];
  const dataRows = rows.map((row) => header.map((key) => row[key] || ""));
  const worksheet = XLSX.utils.aoa_to_sheet([header, ...dataRows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "סיכום נוכחות");
  const content = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  return {
    content,
    filename: buildFileName(report, "xlsx"),
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  };
}

export async function buildAttendanceSummaryPdfExport(input) {
  const { report, sortMode } = await requireSummaryReport(input);
  const rows = buildSummaryRows(report, sortMode).map((row, index) => ({
    rowNumber: String(index + 1),
    studentName: row["שם תלמיד"],
    studentClass: row["שיעור"],
    ...Object.fromEntries(
      ATTENDANCE_SESSION_TYPE_ORDER.map((sessionType) => [sessionType, row[ATTENDANCE_SESSION_TYPE_LABELS[sessionType]]])
    ),
    overallPercent: row["אחוז מסכם"]
  }));

  const pdf = await renderInstitutionPdf({
    title: `סיכום נוכחות - ${clean(report.institutionLabel)}`,
    subtitle: `טווח: ${clean(report.dateFrom)} עד ${clean(report.dateTo)} | מיון: ${ATTENDANCE_SUMMARY_SORT_LABELS[sortMode]} | תלמידים: ${report.totalStudents} | מפגשים: ${report.totalSessions}`,
    orientation: "landscape",
    columns: [
      { key: "rowNumber", label: "#", kind: "rowNumber" },
      { key: "studentName", label: "שם תלמיד" },
      { key: "studentClass", label: "שיעור" },
      ...ATTENDANCE_SESSION_TYPE_ORDER.map((sessionType) => ({
        key: sessionType,
        label: ATTENDANCE_SESSION_TYPE_LABELS[sessionType]
      })),
      { key: "overallPercent", label: "אחוז מסכם" }
    ],
    rows
  });

  return {
    content: pdf,
    filename: buildFileName(report, "pdf"),
    contentType: "application/pdf"
  };
}
