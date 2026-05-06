import { renderInstitutionPdf } from "./institution-pdf";
import * as XLSX from "xlsx";
import { getStudentsByInstitution, listAllStudents } from "./twenty";
import { listNeonStudentsByFilters } from "./neon-students";
import {
  applyAdvancedFilters,
  buildMissingState,
  clean,
  columnText,
  DEFAULT_INSTITUTION_COLUMN_KEYS,
  findInstitutionCode,
  INSTITUTION_COLUMN_MAP,
  INSTITUTIONS,
  matchesMissingFilter,
  parseAdvancedFilters,
  parseListParam,
  parsePdfBlankColumns,
  parseSortLevels,
  PDF_PRINT_ONLY_COLUMN_MAP,
  sortStudents
} from "./student-view";

function csvEscape(value) {
  const text = String(value ?? "");
  if (text.includes('"') || text.includes(",") || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildReportTitle({ source, institutionCodes }) {
  const normalizedCodes = Array.isArray(institutionCodes) ? institutionCodes.filter(Boolean) : [institutionCodes].filter(Boolean);
  const institutionLabel = normalizedCodes.length === 1
    ? (INSTITUTIONS?.[normalizedCodes[0]] || normalizedCodes[0])
    : normalizedCodes.length > 1
      ? "כמה מוסדות"
      : "כלל התלמידים";
  return source === "neon" ? `Neon - ${institutionLabel}` : institutionLabel;
}

function buildReportSubtitle({ source, studentsCount, blankColumns }) {
  const sourceLabel = source === "neon" ? "מקור: Neon" : "מקור: Twenty";
  const extrasLabel = blankColumns.length ? ` | עמודות מילוי ידני: ${blankColumns.length}` : "";
  return `${sourceLabel} | מספר רשומות: ${studentsCount}${extrasLabel}`;
}

function sanitizeFilenamePart(value) {
  return clean(value)
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildExportFilename({ source, institutionCodes, extension }) {
  const normalizedCodes = Array.isArray(institutionCodes) ? institutionCodes.filter(Boolean) : [institutionCodes].filter(Boolean);
  const scopeLabel = sanitizeFilenamePart(
    normalizedCodes.length === 1
      ? (INSTITUTIONS?.[normalizedCodes[0]] || normalizedCodes[0])
      : normalizedCodes.length > 1
        ? "כמה מוסדות"
        : "תלמידים מסוננים"
  );
  const prefixLabel = source === "neon" ? "תלמידי ניאון" : "תלמידים";
  return `${prefixLabel} - ${scopeLabel} - ${new Date().toISOString().slice(0, 10)}.${extension}`;
}

function ensureDefaultPdfBlankColumns(columns = []) {
  const ordered = Array.isArray(columns) ? [...columns] : [];
  if (!ordered.includes("blankAttendance")) {
    ordered.unshift("blankAttendance");
  }
  return ordered.filter((key, index) => key && ordered.indexOf(key) === index);
}

export function parseInstitutionExportRequest(input) {
  const searchParams = input instanceof URLSearchParams
    ? input
    : new URL(String(input), "https://internal.local").searchParams;

  const source = clean(searchParams.get("source")).toLowerCase();
  const institutions = parseListParam(searchParams.getAll("institution")).map((value) => clean(value).toUpperCase()).filter(Boolean);
  const institutionSearch = clean(searchParams.get("institutionSearch"));
  const missingOnly = clean(searchParams.get("missingOnly")) === "1";
  const missingTypeParam = clean(searchParams.get("missingType")).toLowerCase();
  const missingType = ["contact", "identity"].includes(missingTypeParam)
    ? missingTypeParam
    : (missingOnly ? "contact" : "");
  const quickClass = parseListParam(searchParams.getAll("quickClass")).map((value) => clean(value).toUpperCase()).filter(Boolean);
  const quickRegistration = parseListParam(searchParams.getAll("quickRegistration")).map((value) => clean(value).toUpperCase()).filter(Boolean);
  const quickFamilyStatus = parseListParam(searchParams.getAll("quickFamilyStatus")).map((value) => clean(value).toUpperCase()).filter(Boolean);
  const quickHealthInsurance = parseListParam(searchParams.getAll("quickHealthInsurance")).map((value) => clean(value).toUpperCase()).filter(Boolean);
  const pdfOrientation = clean(searchParams.get("pdfOrientation")).toLowerCase();
  const sortLevels = parseSortLevels({
    sby: searchParams.getAll("sby"),
    sdir: searchParams.getAll("sdir"),
    sortBy: searchParams.get("sortBy"),
    sortDir: searchParams.get("sortDir")
  });
  const filters = parseAdvancedFilters({
    ff: searchParams.getAll("ff"),
    fo: searchParams.getAll("fo"),
    fv: searchParams.getAll("fv"),
    fj: searchParams.getAll("fj"),
    fg: searchParams.getAll("fg"),
    gj: searchParams.getAll("gj")
  });
  const requestedCols = searchParams.getAll("cols").map(clean).filter(Boolean);
  const selectedCols = (requestedCols.length ? requestedCols : DEFAULT_INSTITUTION_COLUMN_KEYS)
    .filter((key) => INSTITUTION_COLUMN_MAP[key]);
  const pdfBlankColumnKeys = ensureDefaultPdfBlankColumns(parsePdfBlankColumns({
    pdfBlankCol: searchParams.getAll("pdfBlankCol")
  }));
  const scopedInstitutionCodes = institutions.length
    ? institutions
    : (() => {
        const code = findInstitutionCode(
          filters.find((filter) => clean(filter.field) === "institution" && filter.operator === "equals")?.value
        );
        return code ? [code] : [];
      })();

  return {
    source,
    institutionSearch,
    missingType,
    quickClass,
    quickRegistration,
    quickFamilyStatus,
    quickHealthInsurance,
    pdfOrientation,
    sortLevels,
    filters,
    selectedCols,
    pdfBlankColumnKeys,
    scopedInstitutionCodes
  };
}

export async function listInstitutionExportStudents(config) {
  const {
    source,
    institutionSearch,
    missingType,
    quickClass,
    quickRegistration,
    quickFamilyStatus,
    quickHealthInsurance,
    sortLevels,
    filters,
    scopedInstitutionCodes
  } = config;

  let students;
  if (source === "neon") {
    students = await listNeonStudentsByFilters({
      institution: scopedInstitutionCodes,
      institutionSearch,
      class: quickClass,
      registration: quickRegistration,
      famliystatus: quickFamilyStatus,
      healthInsurance: quickHealthInsurance
    });
  } else {
    students = scopedInstitutionCodes.length === 1 ? await getStudentsByInstitution(scopedInstitutionCodes[0]) : await listAllStudents();
    if (institutionSearch) {
      const term = institutionSearch.toLowerCase();
      students = students.filter((student) => clean(student.label).toLowerCase().includes(term));
    }
  }

  students = students.map((student) => {
    const missingState = buildMissingState(student);
    return { ...student, missingItems: missingState.items, missingFlags: missingState.flags };
  });

  if (missingType) {
    students = students.filter((student) => matchesMissingFilter({ flags: student.missingFlags }, missingType));
  }

  if (source !== "neon") {
    if (scopedInstitutionCodes.length > 1) {
      students = students.filter((student) => scopedInstitutionCodes.includes(clean(student?.currentInstitution).toUpperCase()));
    }
    if (quickClass.length) {
      students = students.filter((student) => quickClass.includes(clean(student?.class).toUpperCase()));
    }
    if (quickRegistration.length) {
      students = students.filter((student) => quickRegistration.includes(clean(student?.registration).toUpperCase()));
    }
    if (quickFamilyStatus.length) {
      students = students.filter((student) => quickFamilyStatus.includes(clean(student?.famliystatus).toUpperCase()));
    }
    if (quickHealthInsurance.length) {
      students = students.filter((student) => quickHealthInsurance.includes(clean(student?.healthInsurance).toUpperCase()));
    }
  }

  students = applyAdvancedFilters(students, filters);
  students = sortStudents(students, sortLevels);
  return students;
}

export async function buildInstitutionCsvExport(input) {
  const config = parseInstitutionExportRequest(input);
  const students = await listInstitutionExportStudents(config);

  const header = config.selectedCols.map((columnKey) => INSTITUTION_COLUMN_MAP[columnKey]?.label || columnKey);
  const rows = students.map((student) => config.selectedCols.map((columnKey) => columnText(student, columnKey)));
  const worksheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "תלמידים");
  const content = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  const filename = buildExportFilename({
    source: config.source,
    institutionCodes: config.scopedInstitutionCodes,
    extension: "xlsx"
  });

  return {
    content,
    filename,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  };
}

export async function buildInstitutionPdfExport(input) {
  const config = parseInstitutionExportRequest(input);
  const students = await listInstitutionExportStudents(config);

  const columns = [
    { key: "rowNumber", label: "#", kind: "rowNumber" },
    ...config.selectedCols.map((columnKey) => ({
      key: columnKey,
      label: INSTITUTION_COLUMN_MAP[columnKey]?.label || columnKey,
      kind: "data"
    })),
    ...config.pdfBlankColumnKeys.map((columnKey) => PDF_PRINT_ONLY_COLUMN_MAP[columnKey]).filter(Boolean)
  ];

  const rows = students.map((student, index) => {
    const row = { rowNumber: String(index + 1) };
    config.selectedCols.forEach((columnKey) => {
      row[columnKey] = columnText(student, columnKey);
    });
    config.pdfBlankColumnKeys.forEach((columnKey) => {
      row[columnKey] = "";
    });
    return row;
  });

  const pdf = await renderInstitutionPdf({
    title: buildReportTitle({ source: config.source, institutionCodes: config.scopedInstitutionCodes }),
    subtitle: buildReportSubtitle({ source: config.source, studentsCount: students.length, blankColumns: config.pdfBlankColumnKeys }),
    columns,
    rows,
    orientation: config.pdfOrientation
  });

  const filename = buildExportFilename({
    source: config.source,
    institutionCodes: config.scopedInstitutionCodes,
    extension: "pdf"
  });

  return {
    content: pdf,
    filename,
    contentType: "application/pdf"
  };
}
