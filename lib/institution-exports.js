import { renderInstitutionPdf } from "./institution-pdf";
import { buildInstitutionTemplateExport } from "./institution-export-templates.js";
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

function buildReportTitle({ source, institutionCode }) {
  const institutionLabel = INSTITUTIONS?.[institutionCode] || institutionCode || "כלל התלמידים";
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

function buildExportFilename({ source, institutionCode, extension }) {
  const scopeLabel = sanitizeFilenamePart(INSTITUTIONS?.[institutionCode] || institutionCode || "תלמידים מסוננים");
  const prefixLabel = source === "neon" ? "תלמידי ניאון" : "תלמידים";
  return `${prefixLabel} - ${scopeLabel} - ${new Date().toISOString().slice(0, 10)}.${extension}`;
}

export function parseInstitutionExportRequest(input) {
  const searchParams = input instanceof URLSearchParams
    ? input
    : new URL(String(input), "https://internal.local").searchParams;

  const source = clean(searchParams.get("source")).toLowerCase();
  const institution = clean(searchParams.get("institution"));
  const institutionSearch = clean(searchParams.get("institutionSearch"));
  const missingOnly = clean(searchParams.get("missingOnly")) === "1";
  const missingTypeParam = clean(searchParams.get("missingType")).toLowerCase();
  const missingType = ["contact", "identity"].includes(missingTypeParam)
    ? missingTypeParam
    : (missingOnly ? "contact" : "");
  const quickClass = clean(searchParams.get("quickClass")).toUpperCase();
  const quickRegistration = clean(searchParams.get("quickRegistration")).toUpperCase();
  const quickFamilyStatus = clean(searchParams.get("quickFamilyStatus")).toUpperCase();
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
  const pdfBlankColumnKeys = parsePdfBlankColumns({
    pdfBlankCol: searchParams.getAll("pdfBlankCol")
  });
  const templateId = clean(searchParams.get("template"));
  const templateSection = clean(searchParams.get("templateSection"));
  const scopedInstitutionCode = institution || findInstitutionCode(
    filters.find((filter) => clean(filter.field) === "institution" && filter.operator === "equals")?.value
  );

  return {
    source,
    institutionSearch,
    missingType,
    quickClass,
    quickRegistration,
    quickFamilyStatus,
    pdfOrientation,
    sortLevels,
    filters,
    selectedCols,
    pdfBlankColumnKeys,
    templateId,
    templateSection,
    scopedInstitutionCode
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
    sortLevels,
    filters,
    scopedInstitutionCode
  } = config;

  let students;
  if (source === "neon") {
    students = await listNeonStudentsByFilters({
      institution: scopedInstitutionCode,
      institutionSearch,
      class: quickClass,
      registration: quickRegistration,
      famliystatus: quickFamilyStatus
    });
  } else {
    students = scopedInstitutionCode ? await getStudentsByInstitution(scopedInstitutionCode) : await listAllStudents();
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
    if (quickClass) {
      students = students.filter((student) => clean(student?.class).toUpperCase() === quickClass);
    }
    if (quickRegistration) {
      students = students.filter((student) => clean(student?.registration).toUpperCase() === quickRegistration);
    }
    if (quickFamilyStatus) {
      students = students.filter((student) => clean(student?.famliystatus).toUpperCase() === quickFamilyStatus);
    }
  }

  students = applyAdvancedFilters(students, filters);
  students = sortStudents(students, sortLevels);
  return students;
}

export async function buildInstitutionCsvExport(input) {
  const config = parseInstitutionExportRequest(input);
  const students = await listInstitutionExportStudents(config);

  if (config.templateId) {
    return buildInstitutionTemplateExport({
      templateId: config.templateId,
      templateSection: config.templateSection,
      students,
      source: config.source
    });
  }

  const header = config.selectedCols.map((columnKey) => INSTITUTION_COLUMN_MAP[columnKey]?.label || columnKey);
  const rows = students.map((student) => config.selectedCols.map((columnKey) => columnText(student, columnKey)));
  const csv = [
    header.map(csvEscape).join(","),
    ...rows.map((row) => row.map(csvEscape).join(","))
  ].join("\n");

  const filename = buildExportFilename({
    source: config.source,
    institutionCode: config.scopedInstitutionCode,
    extension: "csv"
  });

  return {
    content: `\uFEFF${csv}`,
    filename,
    contentType: "text/csv; charset=utf-8"
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
    title: buildReportTitle({ source: config.source, institutionCode: config.scopedInstitutionCode }),
    subtitle: buildReportSubtitle({ source: config.source, studentsCount: students.length, blankColumns: config.pdfBlankColumnKeys }),
    columns,
    rows,
    orientation: config.pdfOrientation
  });

  const filename = buildExportFilename({
    source: config.source,
    institutionCode: config.scopedInstitutionCode,
    extension: "pdf"
  });

  return {
    content: pdf,
    filename,
    contentType: "application/pdf"
  };
}
