import { NextResponse } from "next/server";
import { getCurrentAppUser } from "../../../../lib/rbac";
import {
  buildMissingState,
  columnText,
  DEFAULT_INSTITUTION_COLUMN_KEYS,
  INSTITUTIONS,
  INSTITUTION_COLUMN_MAP,
  matchesMissingFilter,
  parseAdvancedFilters,
  parseSortLevels,
  sortStudents,
  applyAdvancedFilters,
  clean
} from "../../../../lib/student-view";
import { getStudentsByInstitution, listAllStudents } from "../../../../lib/twenty";
import { getNeonStudentsByInstitution, listAllNeonStudents } from "../../../../lib/neon-students";

function findInstitutionCode(value) {
  const normalized = clean(value).toLowerCase();
  if (!normalized) return "";
  for (const [code, label] of Object.entries(INSTITUTIONS || {})) {
    if (clean(code).toLowerCase() === normalized || clean(label).toLowerCase() === normalized) return code;
  }
  return "";
}
function csvEscape(value) {
  const text = String(value ?? "");
  if (text.includes('"') || text.includes(",") || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
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



  const requestedCols = url.searchParams.getAll("cols").map(clean).filter(Boolean);
  const selectedCols = (requestedCols.length ? requestedCols : DEFAULT_INSTITUTION_COLUMN_KEYS).filter((k) => INSTITUTION_COLUMN_MAP[k]);

  const scopedInstitutionCode = institution || findInstitutionCode(
    filters.find((filter) => clean(filter.field) === "institution" && filter.operator === "equals")?.value
  );

  let students;
  if (source === "neon") {
    students = scopedInstitutionCode ? await getNeonStudentsByInstitution(scopedInstitutionCode) : await listAllNeonStudents();
  } else {
    students = scopedInstitutionCode ? await getStudentsByInstitution(scopedInstitutionCode) : await listAllStudents();
  }
  if (institutionSearch) {
    const s = institutionSearch.toLowerCase();
    students = students.filter((x) => clean(x.label).toLowerCase().includes(s));
  }

  students = students.map((student) => {
    const missingState = buildMissingState(student);
    return { ...student, missingItems: missingState.items, missingFlags: missingState.flags };
  });

  if (missingType) {
    students = students.filter((student) => matchesMissingFilter({ flags: student.missingFlags }, missingType));
  }

  students = applyAdvancedFilters(students, filters);
  students = sortStudents(students, sortLevels);

  const header = selectedCols.map((columnKey) => INSTITUTION_COLUMN_MAP[columnKey]?.label || columnKey);
  const rows = students.map((student) => selectedCols.map((columnKey) => columnText(student, columnKey)));

  const csv = [
    header.map(csvEscape).join(","),
    ...rows.map((row) => row.map(csvEscape).join(","))
  ].join("\n");

  const bom = "\uFEFF";
  const filenameScope = scopedInstitutionCode || "filtered";
  const filenamePrefix = source === "neon" ? "students-neon" : "students";
  const filename = `${filenamePrefix}-${filenameScope}-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(bom + csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`
    }
  });
}




