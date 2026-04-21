import { NextResponse } from "next/server";
import { getCurrentAppUser } from "../../../../lib/rbac";
import { renderInstitutionPdf } from "../../../../lib/institution-pdf";
import { getStudentsByInstitution, listAllStudents } from "../../../../lib/twenty";
import { listNeonStudentsByFilters } from "../../../../lib/neon-students";
import {
  applyAdvancedFilters,
  buildMissingState,
  clean,
  DEFAULT_INSTITUTION_COLUMN_KEYS,
  findInstitutionCode,
  INSTITUTION_COLUMN_MAP,
  INSTITUTIONS,
  matchesMissingFilter,
  parseAdvancedFilters,
  parsePdfBlankColumns,
  parseSortLevels,
  sortStudents,
  columnText,
  PDF_PRINT_ONLY_COLUMN_MAP
} from "../../../../lib/student-view";

function buildReportTitle({ source, institutionCode }) {
  const institutionLabel = INSTITUTIONS?.[institutionCode] || institutionCode || "כלל התלמידים";
  return source === "neon" ? `Neon - ${institutionLabel}` : institutionLabel;
}

function buildReportSubtitle({ source, studentsCount, blankColumns }) {
  const sourceLabel = source === "neon" ? "מקור: Neon" : "מקור: Twenty";
  const extrasLabel = blankColumns.length ? ` | עמודות מילוי ידני: ${blankColumns.length}` : "";
  return `${sourceLabel} | מספר רשומות: ${studentsCount}${extrasLabel}`;
}

export async function GET(request) {
  const user = await getCurrentAppUser();
  if (!user || (!user.is_team_member && !user.is_manager)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const url = new URL(request.url);
  const source = clean(url.searchParams.get("source")).toLowerCase();
  const institution = clean(url.searchParams.get("institution"));
  const institutionSearch = clean(url.searchParams.get("institutionSearch"));
  const missingOnly = clean(url.searchParams.get("missingOnly")) === "1";
  const missingTypeParam = clean(url.searchParams.get("missingType")).toLowerCase();
  const missingType = ["contact", "identity"].includes(missingTypeParam)
    ? missingTypeParam
    : (missingOnly ? "contact" : "");
  const quickClass = clean(url.searchParams.get("quickClass")).toUpperCase();
  const quickRegistration = clean(url.searchParams.get("quickRegistration")).toUpperCase();
  const quickFamilyStatus = clean(url.searchParams.get("quickFamilyStatus")).toUpperCase();
  const pdfOrientation = clean(url.searchParams.get("pdfOrientation")).toLowerCase();
  const sortLevels = parseSortLevels({
    sby: url.searchParams.getAll("sby"),
    sdir: url.searchParams.getAll("sdir"),
    sortBy: url.searchParams.get("sortBy"),
    sortDir: url.searchParams.get("sortDir")
  });
  const filters = parseAdvancedFilters({
    ff: url.searchParams.getAll("ff"),
    fo: url.searchParams.getAll("fo"),
    fv: url.searchParams.getAll("fv"),
    fj: url.searchParams.getAll("fj"),
    fg: url.searchParams.getAll("fg"),
    gj: url.searchParams.getAll("gj")
  });
  const pdfBlankColumnKeys = parsePdfBlankColumns({
    pdfBlankCol: url.searchParams.getAll("pdfBlankCol")
  });

  const requestedCols = url.searchParams.getAll("cols").map(clean).filter(Boolean);
  const selectedCols = (requestedCols.length ? requestedCols : DEFAULT_INSTITUTION_COLUMN_KEYS).filter((key) => INSTITUTION_COLUMN_MAP[key]);
  const scopedInstitutionCode = institution || findInstitutionCode(
    filters.find((filter) => clean(filter.field) === "institution" && filter.operator === "equals")?.value
  );

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

  const columns = [
    {
      key: "rowNumber",
      label: "#",
      kind: "rowNumber"
    },
    ...selectedCols.map((columnKey) => ({
      key: columnKey,
      label: INSTITUTION_COLUMN_MAP[columnKey]?.label || columnKey,
      kind: "data"
    })),
    ...pdfBlankColumnKeys.map((columnKey) => PDF_PRINT_ONLY_COLUMN_MAP[columnKey]).filter(Boolean)
  ];

  const rows = students.map((student, index) => {
    const row = {};
    row.rowNumber = String(index + 1);
    selectedCols.forEach((columnKey) => {
      row[columnKey] = columnText(student, columnKey);
    });
    pdfBlankColumnKeys.forEach((columnKey) => {
      row[columnKey] = "";
    });
    return row;
  });

  const pdf = await renderInstitutionPdf({
    title: buildReportTitle({ source, institutionCode: scopedInstitutionCode }),
    subtitle: buildReportSubtitle({ source, studentsCount: students.length, blankColumns: pdfBlankColumnKeys }),
    columns,
    rows,
    orientation: pdfOrientation
  });

  const scope = scopedInstitutionCode || "filtered";
  const prefix = source === "neon" ? "students-neon" : "students";
  const filename = `${prefix}-${scope}-${new Date().toISOString().slice(0, 10)}.pdf`;

  return new NextResponse(pdf, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`
    }
  });
}
