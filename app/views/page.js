import { redirect } from "next/navigation";
import ViewBuilderClient from "./view-builder-client";
import { getCurrentAppUser } from "../../lib/rbac";
import { listSavedViewsForUser } from "../../lib/saved-views";
import {
  applyAdvancedFilters,
  buildMissingState,
  classLabel,
  clean,
  columnText,
  DEFAULT_INSTITUTION_COLUMN_KEYS,
  FILTERABLE_FIELDS,
  FILTER_OPERATORS,
  FILTER_VALUE_OPTIONS,
  findInstitutionCode,
  INSTITUTION_COLUMNS_FULL,
  INSTITUTION_COLUMN_MAP,
  matchesMissingFilter,
  parseAdvancedFilters,
  parseListParam,
  parseSortLevels,
  sanitizeQueryString,
  SORT_OPTIONS,
  sortStudents
} from "../../lib/student-view";
import { getStudentsByInstitution, listAllStudents } from "../../lib/twenty";

function buildQueryString(params) {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (Array.isArray(value)) {
      value.map((item) => clean(item)).filter(Boolean).forEach((item) => sp.append(key, item));
      continue;
    }
    const next = clean(value);
    if (next) sp.set(key, next);
  }
  return sp.toString();
}

async function buildPreview(resolvedSearchParams) {
  const filters = parseAdvancedFilters(resolvedSearchParams);
  const selectedColumnKeys = parseListParam(resolvedSearchParams?.cols).filter((key) => INSTITUTION_COLUMN_MAP[key]);
  const columns = (selectedColumnKeys.length ? selectedColumnKeys : DEFAULT_INSTITUTION_COLUMN_KEYS)
    .map((key) => INSTITUTION_COLUMN_MAP[key])
    .filter(Boolean);

  const sortLevels = parseSortLevels(resolvedSearchParams);
  const institution = clean(resolvedSearchParams?.institution);
  const institutionSearch = clean(resolvedSearchParams?.institutionSearch);
  const missingType = clean(resolvedSearchParams?.missingType).toLowerCase();
  const effectiveMissingType = ["contact", "identity"].includes(missingType) ? missingType : "";
  const scopedInstitutionCode = institution || findInstitutionCode(
    filters.find((filter) => clean(filter.field) === "institution" && filter.operator === "equals")?.value
  );

  let students = [];
  let previewReady = false;

  if (scopedInstitutionCode) {
    students = await getStudentsByInstitution(scopedInstitutionCode);
    previewReady = true;
  } else if (filters.length) {
    students = await listAllStudents();
    previewReady = true;
  }

  if (!previewReady) {
    return {
      previewReady: false,
      previewCount: 0,
      previewRows: [],
      previewColumns: columns
    };
  }

  if (institutionSearch) {
    const term = institutionSearch.toLowerCase();
    students = students.filter((student) => clean(student.label).toLowerCase().includes(term));
  }

  students = students.map((student) => {
    const missingState = buildMissingState(student);
    return { ...student, missingItems: missingState.items, missingFlags: missingState.flags };
  });

  if (effectiveMissingType) {
    students = students.filter((student) => matchesMissingFilter({ flags: student.missingFlags }, effectiveMissingType));
  }

  students = applyAdvancedFilters(students, filters);
  students = sortStudents(students, sortLevels);

  const previewRows = students.slice(0, 30).map((student) => ({
    id: student.id,
    label: clean(student.label) || "��� ��",
    classLabel: classLabel(student.class),
    hasMissing: Array.isArray(student.missingItems) && student.missingItems.length > 0,
    missingText: Array.isArray(student.missingItems) && student.missingItems.length ? student.missingItems.join(", ") : "-",
    values: Object.fromEntries(columns.map((column) => [column.key, columnText(student, column.key)]))
  }));

  return {
    previewReady: true,
    previewCount: students.length,
    previewRows,
    previewColumns: columns
  };
}

export default async function ViewsPage({ searchParams }) {
  const currentUser = await getCurrentAppUser();
  if (!currentUser) redirect("/sign-in");
  if (!currentUser.is_team_member && !currentUser.is_manager) redirect("/unauthorized");

  const resolvedSearchParams = await searchParams;
  const filters = parseAdvancedFilters(resolvedSearchParams).map((filter) => ({
    joiner: filter.joiner,
    field: filter.field,
    operator: filter.operator,
    value: filter.value,
    groupId: filter.groupId,
    groupJoiner: filter.groupJoiner
  }));
  const savedViews = await listSavedViewsForUser(currentUser.clerk_user_id);
  const sortLevels = parseSortLevels(resolvedSearchParams);
  const preview = await buildPreview(resolvedSearchParams);
  const currentQueryString = sanitizeQueryString(buildQueryString(resolvedSearchParams));
  const exportHref = currentQueryString ? `/api/export/institution?${currentQueryString}` : "/api/export/institution";

  return (
    <ViewBuilderClient
      savedViews={savedViews}
      currentViewId={clean(resolvedSearchParams?.savedViewId)}
      status={{
        saved: clean(resolvedSearchParams?.saved),
        updated: clean(resolvedSearchParams?.updated),
        deleted: clean(resolvedSearchParams?.deleted)
      }}
      currentQueryString={currentQueryString}
      exportHref={exportHref}
      columnOptions={INSTITUTION_COLUMNS_FULL}
      filterFieldOptions={FILTERABLE_FIELDS}
      filterOperatorOptions={FILTER_OPERATORS}
      filterValueOptions={FILTER_VALUE_OPTIONS}
      sortOptions={SORT_OPTIONS}
      preview={preview}
      initialState={{
        sortLevels,
        cols: parseListParam(resolvedSearchParams?.cols).length ? parseListParam(resolvedSearchParams?.cols) : DEFAULT_INSTITUTION_COLUMN_KEYS,
        filters
      }}
    />
  );
}

