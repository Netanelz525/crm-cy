import Link from "next/link";
import { redirect } from "next/navigation";
import { purgeExpiredSoftDeletedStudents } from "../../lib/deleted-students";
import { ENUM_LABELS } from "../../lib/student-fields";
import { getNeonPreferencesForUser, mergeSearchParamsWithNeonPreferences } from "../../lib/neon-preferences";
import { getCurrentAppUser } from "../../lib/rbac";
import { attachLatestContactToStudents } from "../../lib/student-contact-logs";
import { listUpcomingStudentEvents } from "../../lib/student-events";
import { attachStudentTagsToStudents, listStudentTagsWithUsage } from "../../lib/student-tags";
import {
  applyAdvancedFilters,
  buildMissingState,
  clean,
  DEFAULT_INSTITUTION_COLUMN_KEYS,
  INSTITUTIONS,
  INSTITUTION_COLUMN_MAP,
  matchesMissingFilter,
  parseAdvancedFilters,
  parsePdfBlankColumns,
  parseListParam,
  parseSortLevels,
  PDF_PRINT_ONLY_COLUMNS,
  SORT_OPTIONS,
  sanitizeQueryString,
  sortStudents
} from "../../lib/student-view";
import {
  getNeonStudentsStats,
  listNeonStudentsByFilters,
  searchNeonStudentsByText,
  searchNeonStudentsByTz
} from "../../lib/neon-students";
import {
  addStudentTagFromSearchAction,
  addStudentContactFromSearchAction,
  removeStudentTagFromSearchAction,
  prepareNeonStudentsImportAction,
  resetNeonPreferencesAction,
  saveNeonPreferencesAction
} from "./actions";
import BulkStudentsClient from "./bulk-students-client";

const NEON_SORT_LEVEL_COUNT = 3;
const NEON_SORT_OPTIONS = SORT_OPTIONS.map((option) => (
  option.key === "name"
    ? { ...option, label: "שם משפחה" }
    : option
));

const QUICK_FILTER_FIELDS = [
  { key: "institution", paramName: "institution", label: "מוסד", options: INSTITUTIONS },
  { key: "registration", paramName: "quickRegistration", label: "רישום", options: ENUM_LABELS.registration || {} },
  { key: "class", paramName: "quickClass", label: "שיעור", options: ENUM_LABELS.class || {} },
  { key: "famliystatus", paramName: "quickFamilyStatus", label: "מצב משפחתי", options: ENUM_LABELS.familystatus || {} },
  { key: "healthInsurance", paramName: "quickHealthInsurance", label: "קופת חולים", options: ENUM_LABELS.healthInsurance || {} }
];

function buildQueryString(params) {
  const sp = new URLSearchParams();
  const invalidEntry = (key, value = "") => {
    const normalizedKey = clean(key).toLowerCase();
    const normalizedValue = clean(value).toLowerCase();
    if (!normalizedKey) return true;
    if (normalizedKey.includes("[object object]") || normalizedValue.includes("[object object]")) return true;
    if (["undefined", "null"].includes(normalizedKey)) return true;
    return false;
  };
  for (const [key, value] of Object.entries(params || {})) {
    if (invalidEntry(key)) continue;
    if (Array.isArray(value)) {
      value.map(clean).filter(Boolean).forEach((item) => {
        if (!invalidEntry(key, item)) sp.append(key, item);
      });
      continue;
    }
    const next = clean(value);
    if (next && !invalidEntry(key, next)) sp.set(key, next);
  }
  return sp.toString();
}

function buildNextPath(params) {
  const query = buildQueryString(params);
  return query ? `/neon?${query}` : "/neon";
}

function findInstitutionCode(value) {
  const normalized = clean(value).toLowerCase();
  if (!normalized) return "";
  for (const [code, label] of Object.entries(INSTITUTIONS)) {
    if (clean(code).toLowerCase() === normalized || clean(label).toLowerCase() === normalized) return code;
  }
  return "";
}

function hasInstitutionScopedFilter(filters) {
  return filters.some((filter) => clean(filter.field) === "institution");
}

function hasExplicitSortParams(searchParams) {
  return parseListParam(searchParams?.sby).length > 0 || Boolean(clean(searchParams?.sortBy));
}

function getNeonInstitutionSortLevels(searchParams) {
  if (!hasExplicitSortParams(searchParams)) {
    return [
      { sortBy: "class", sortDir: "asc" },
      { sortBy: "name", sortDir: "asc" }
    ];
  }
  return parseSortLevels(searchParams);
}

function sortLevelAt(sortLevels, index) {
  return sortLevels[index] || { sortBy: "", sortDir: "asc" };
}

function normalizeMultiValues(value) {
  return parseListParam(value).map((item) => clean(item).toUpperCase()).filter(Boolean);
}

function hiddenValues(name, values) {
  return (values || []).map((value) => <input key={`${name}-${value}`} type="hidden" name={name} value={value} />);
}

function quickFilterSummary(label, options, selectedValues) {
  const selectedSet = new Set(selectedValues || []);
  const selectedLabels = Object.entries(options || {})
    .filter(([value]) => selectedSet.has(clean(value).toUpperCase()))
    .map(([, optionLabel]) => optionLabel);
  if (!selectedLabels.length) return `${label}: הכל`;
  if (selectedLabels.length === 1) return `${label}: ${selectedLabels[0]}`;
  return `${label}: ${selectedLabels.length} נבחרו`;
}

function enumDropdownGroup(name, label, options, selectedValues) {
  const selectedSet = new Set(selectedValues || []);
  return (
    <details className="display-settings" open={selectedSet.size > 0}>
      <summary>{quickFilterSummary(label, options, selectedValues)}</summary>
      <div className="column-grid" style={{ marginTop: 10 }}>
        {Object.entries(options || {}).map(([value, optionLabel]) => (
          <label key={`${name}-${value}`} className="column-item">
            <input type="checkbox" name={name} value={value} defaultChecked={selectedSet.has(clean(value).toUpperCase())} />
            <span>{optionLabel}</span>
          </label>
        ))}
      </div>
    </details>
  );
}

export default async function NeonPage({ searchParams }) {
  const currentUser = await getCurrentAppUser();
  if (!currentUser) redirect("/sign-in");
  await purgeExpiredSoftDeletedStudents();

  const incomingSearchParams = await searchParams;

  if (!currentUser.is_team_member && !currentUser.is_manager) {
    if (currentUser.linked_student_id) redirect(`/neon/students/${currentUser.linked_student_id}`);
    redirect("/unauthorized");
  }

  const incomingQueryString = sanitizeQueryString(buildQueryString(incomingSearchParams));
  let neonPreferences = null;
  let preferencesLoadError = "";

  try {
    neonPreferences = await getNeonPreferencesForUser(currentUser.clerk_user_id);
  } catch (error) {
    preferencesLoadError = clean(error?.message || "טעינת ההעדפות האישיות נכשלה");
  }

  const savedPreferenceQueryString = sanitizeQueryString(neonPreferences?.query_string || "");
  const mergedSearchParams = savedPreferenceQueryString
    ? mergeSearchParamsWithNeonPreferences(incomingSearchParams, savedPreferenceQueryString)
    : new URLSearchParams(buildQueryString(incomingSearchParams));
  const mergedQueryString = sanitizeQueryString(mergedSearchParams.toString());

  if (savedPreferenceQueryString && mergedQueryString && mergedQueryString !== incomingQueryString) {
    redirect(`/neon?${mergedQueryString}`);
  }

  const resolvedSearchParams = incomingSearchParams;

  const currentQueryString = sanitizeQueryString(buildQueryString(resolvedSearchParams));
  const selectedInstitutions = normalizeMultiValues(resolvedSearchParams?.institution);
  const institution = selectedInstitutions[0] || "";
  const institutionSearch = clean(resolvedSearchParams?.institutionSearch);
  const missingOnly = clean(resolvedSearchParams?.missingOnly) === "1";
  const missingTypeParam = clean(resolvedSearchParams?.missingType).toLowerCase();
  const missingType = ["contact", "identity"].includes(missingTypeParam) ? missingTypeParam : (missingOnly ? "contact" : "");
  const sortLevels = getNeonInstitutionSortLevels(resolvedSearchParams);
  const advancedFilters = parseAdvancedFilters(resolvedSearchParams);
  const synced = clean(resolvedSearchParams?.synced) === "1";
  const syncCount = clean(resolvedSearchParams?.count);
  const imported = clean(resolvedSearchParams?.imported) === "1";
  const importedUpdated = clean(resolvedSearchParams?.updated);
  const importedSkipped = clean(resolvedSearchParams?.skipped);
  const importedFailed = clean(resolvedSearchParams?.failed);
  const importSessionId = clean(resolvedSearchParams?.importSessionId);
  const importMessage = clean(resolvedSearchParams?.importMessage);
  const importError = clean(resolvedSearchParams?.importError);
  const prefsSaved = clean(resolvedSearchParams?.prefsSaved) === "1";
  const prefsReset = clean(resolvedSearchParams?.prefsReset) === "1";
  const prefsError = clean(resolvedSearchParams?.prefsError);
  const bulkUpdated = clean(resolvedSearchParams?.bulkUpdated) === "1";
  const bulkUpdatedCount = clean(resolvedSearchParams?.updated);
  const bulkFailedCount = clean(resolvedSearchParams?.failed);
  const bulkMessage = clean(resolvedSearchParams?.bulkMessage);
  const selectedClassCodes = normalizeMultiValues(resolvedSearchParams?.quickClass);
  const selectedRegistrationCodes = normalizeMultiValues(resolvedSearchParams?.quickRegistration);
  const selectedFamilyStatusCodes = normalizeMultiValues(resolvedSearchParams?.quickFamilyStatus);
  const selectedHealthInsuranceCodes = normalizeMultiValues(resolvedSearchParams?.quickHealthInsurance);
  const selectedTagIds = parseListParam(resolvedSearchParams?.tag).map(clean).filter(Boolean);
  const tagCreated = clean(resolvedSearchParams?.tagCreated) === "1";
  const tagDeleted = clean(resolvedSearchParams?.tagDeleted) === "1";
  const tagsError = clean(resolvedSearchParams?.tagsError);
  const contactSaved = clean(resolvedSearchParams?.contactSaved) === "1";
  const contactError = clean(resolvedSearchParams?.contactError);

  const tz = clean(resolvedSearchParams?.tz).replace(/[^\d]/g, "");
  const q = clean(resolvedSearchParams?.q);
  const modeParam = clean(resolvedSearchParams?.mode).toLowerCase();
  const mode = modeParam || (
    selectedInstitutions.length
    || institutionSearch
    || missingOnly
    || missingType
    || selectedClassCodes.length
    || selectedRegistrationCodes.length
    || selectedFamilyStatusCodes.length
    || selectedHealthInsuranceCodes.length
    || selectedTagIds.length
    || advancedFilters.length
      ? "institution"
      : q || tz ? "search" : ""
  );

  const parsedColumnKeys = parseListParam(resolvedSearchParams?.cols).filter((key) => INSTITUTION_COLUMN_MAP[key]);
  const selectedColumnKeys = parsedColumnKeys.length ? parsedColumnKeys : DEFAULT_INSTITUTION_COLUMN_KEYS;
  const selectedColumns = selectedColumnKeys.map((key) => INSTITUTION_COLUMN_MAP[key]).filter(Boolean);
  const pdfBlankColumnKeys = parsePdfBlankColumns(resolvedSearchParams);
  const pdfOrientationParam = clean(resolvedSearchParams?.pdfOrientation).toLowerCase();
  const pdfOrientation = pdfOrientationParam === "landscape" ? "landscape" : "portrait";

  let students = [];
  let error = "";

  try {
    if (
      mode === "institution"
      && (
        selectedInstitutions.length
        || selectedClassCodes.length
        || selectedRegistrationCodes.length
        || selectedFamilyStatusCodes.length
        || selectedHealthInsuranceCodes.length
        || selectedTagIds.length
        || advancedFilters.length
      )
    ) {
      const scopedInstitutionCode = selectedInstitutions.length
        ? ""
        : findInstitutionCode(
        advancedFilters.find((filter) => clean(filter.field) === "institution" && filter.operator === "equals")?.value
      );

      students = await listNeonStudentsByFilters({
        institution: selectedInstitutions.length ? selectedInstitutions : scopedInstitutionCode,
        institutionSearch,
        class: selectedClassCodes,
        registration: selectedRegistrationCodes,
        famliystatus: selectedFamilyStatusCodes,
        healthInsurance: selectedHealthInsuranceCodes
      });

      students = students.map((student) => {
        const missingState = buildMissingState(student);
        return { ...student, missingItems: missingState.items, missingFlags: missingState.flags };
      });
      students = await attachStudentTagsToStudents(students);
      students = await attachLatestContactToStudents(students);

      if (missingType) students = students.filter((student) => matchesMissingFilter({ flags: student.missingFlags }, missingType));
      if (selectedTagIds.length) {
        students = students.filter((student) => selectedTagIds.some((tagId) => (student.tagIds || []).includes(tagId)));
      }
      students = applyAdvancedFilters(students, advancedFilters);
      students = sortStudents(students, sortLevels);
    } else if (mode === "search") {
      if (tz) students = (await searchNeonStudentsByTz(tz)).slice(0, 10);
      else if (q) students = await searchNeonStudentsByText(q, 100, 0.4);
      students = await attachStudentTagsToStudents(students);
      students = await attachLatestContactToStudents(students);
    }
  } catch (e) {
    error = e.message || "Search failed";
  }

  const stats = await getNeonStudentsStats();
  const availableTags = await listStudentTagsWithUsage();
  const upcomingEvents = await listUpcomingStudentEvents({ daysAhead: 45, limit: 16 });
  const clearInstitutionFiltersPath = buildNextPath({
    mode: "institution",
    cols: selectedColumnKeys,
    pdfBlankCol: pdfBlankColumnKeys,
    pdfOrientation
  });
  const exportHref = currentQueryString ? `/api/export/institution?source=neon&${currentQueryString}` : "/api/export/institution?source=neon";
  const pdfExportHref = currentQueryString ? `/api/export/institution-pdf?source=neon&${currentQueryString}` : "/api/export/institution-pdf?source=neon";
  const hasInstitutionFilter = hasInstitutionScopedFilter(advancedFilters);
  const institutionCount = students.length;
  const hasQuickFilters = Boolean(
    selectedInstitutions.length
    || selectedClassCodes.length
    || selectedRegistrationCodes.length
    || selectedFamilyStatusCodes.length
    || selectedHealthInsuranceCodes.length
    || selectedTagIds.length
  );
  const showInstitutionView = mode === "institution" && (selectedInstitutions.length || hasInstitutionFilter || hasQuickFilters || selectedTagIds.length || advancedFilters.length);
  const sortSummary = sortLevels
    .map((level, index) => {
      const label = NEON_SORT_OPTIONS.find((option) => option.key === level.sortBy)?.label || level.sortBy;
      return `${index + 1}. ${label} ${level.sortDir === "desc" ? "יורד" : "עולה"}`;
    })
    .join(" | ");

  return (
    <>
      <div className="card glass">
        <div className="student-topbar">
          <div>
            <h1>תלמידים</h1>
            <p className="muted">מרכז ניהול התלמידים הראשי במערכת.</p>
          </div>
          <div className="student-actions student-actions-wrap">
            <Link className="btn btn-primary" href="/students/new">יצירת תלמיד חדש</Link>
            <Link className="btn btn-ghost" href="/admin/deleted-students">אזור מחיקה זמני</Link>
            <form action={saveNeonPreferencesAction}>
              <input type="hidden" name="queryString" value={currentQueryString} />
              <input type="hidden" name="returnPath" value={currentQueryString ? `/neon?${currentQueryString}` : "/neon"} />
              <button className="btn btn-ghost" type="submit">שמור העדפות שלי</button>
            </form>
            <form action={resetNeonPreferencesAction}>
              <button className="btn btn-ghost" type="submit">אפס העדפות</button>
            </form>
          </div>
        </div>
        <div className="student-meta-line">
          <span className="meta-chip">תלמידים במראה: {stats.total || 0}</span>
          <span className="meta-chip">סנכרון אחרון: {stats.last_synced_at ? new Date(stats.last_synced_at).toLocaleString("he-IL") : "עדיין לא בוצע"}</span>
          <span className="meta-chip">{savedPreferenceQueryString ? "העדפות אישיות שמורות" : "ללא העדפות שמורות"}</span>
        </div>
      </div>

      <details className="card linked-records-panel">
        <summary className="linked-records-toggle">
          <div>
            <h3>אירועים קרובים לתלמידים</h3>
            <p className="muted" style={{ marginBottom: 0 }}>לוח מתקפל של האירועים הקרובים מתוך הרשומות המקושרות לתלמידים.</p>
          </div>
          <div className="linked-records-summary">
            <span className="linked-record-pill">קרובים ב-45 יום: {upcomingEvents.length}</span>
          </div>
        </summary>
        {!upcomingEvents.length ? (
          <div className="linked-record-card placeholder">
            <b>עדיין אין אירועים קרובים</b>
            <div className="linked-record-meta">לא נמצאו אירועים מקושרים לטווח הקרוב.</div>
            <div className="linked-record-meta">לאחר שתוסיפו אירועים בכרטיסי תלמיד, הם יופיעו כאן אוטומטית.</div>
          </div>
        ) : (
          <div className="linked-records-grid">
            {upcomingEvents.map((event) => (
              <Link key={event.id} className="linked-record-card event-board-card" href={`/neon/students/${event.studentId}`}>
                <div className="linked-record-card-top">
                  <b>{event.eventLabel}</b>
                  <span className="linked-record-pill">{event.hebrewDateLabel}</span>
                </div>
                <div className="linked-record-title">{event.studentName || "ללא שם"}</div>
                <div className="linked-record-meta">מועד קרוב: {event?.nextOccurrence?.gregorianDisplay || "-"}</div>
                <div className="linked-record-meta">
                  {Number(event?.nextOccurrence?.daysUntil) === 0
                    ? "האירוע חל היום"
                    : Number(event?.nextOccurrence?.daysUntil) === 1
                      ? "האירוע חל מחר"
                      : `האירוע בעוד ${event?.nextOccurrence?.daysUntil || 0} ימים`}
                </div>
                <div className="linked-record-meta">מוסד: {event.currentInstitution || "-"}</div>
                <div className="linked-record-meta">שיעור: {event.studentClass || "-"}</div>
              </Link>
            ))}
          </div>
        )}
      </details>

      {synced ? <div className="ok">הסנכרון הושלם. עודכנו {syncCount || 0} תלמידים.</div> : null}
      {imported ? (
        <div className="ok">
          ייבוא האקסל הושלם. עודכנו {importedUpdated || 0}, דולגו {importedSkipped || 0}, נכשלו {importedFailed || 0}.
          {importMessage ? <div style={{ marginTop: 8 }}>{importMessage}</div> : null}
          {importSessionId ? (
            <div style={{ marginTop: 8 }}>
              <a className="chip-link" href={`/api/neon/import-report/${importSessionId}`}>הורד דוח אקסל מפורט לכל שורה</a>
            </div>
          ) : null}
        </div>
      ) : null}
      {prefsSaved ? <div className="ok">העדפות ה־Neon שלך נשמרו למשתמש הנוכחי.</div> : null}
      {prefsReset ? <div className="ok">העדפות ה־Neon אופסו, והמסך חזר לברירות המחדל.</div> : null}
      {tagCreated ? <div className="ok">התגית נוספה בהצלחה.</div> : null}
      {tagDeleted ? <div className="ok">התגית נמחקה בהצלחה.</div> : null}
      {contactSaved ? <div className="ok">יצירת הקשר נשמרה בהצלחה.</div> : null}
      {prefsError ? <div className="card muted">{prefsError}</div> : null}
      {preferencesLoadError ? <div className="card muted">{preferencesLoadError}</div> : null}
      {tagsError ? <div className="card muted">{tagsError}</div> : null}
      {contactError ? <div className="card muted">{contactError}</div> : null}
      {importError ? <div className="card muted">{importError}</div> : null}
      {bulkUpdated ? (
        <div className="ok">
          העדכון המרוכז הושלם. עודכנו {bulkUpdatedCount || 0}, נכשלו {bulkFailedCount || 0}.
          {bulkMessage ? <div style={{ marginTop: 8 }}>{bulkMessage}</div> : null}
        </div>
      ) : null}

      <div className="card glass">
        <h3>חיפוש כללי תלמידים - Neon</h3>
        <form className="grid" method="GET">
          <input type="hidden" name="mode" value="search" />
          <input name="q" defaultValue={mode === "search" ? q : ""} placeholder="חיפוש לפי שם תלמיד" />
          <input name="tz" defaultValue={mode === "search" ? tz : ""} placeholder="חיפוש לפי תעודת זהות" />
          <button type="submit">חפש תלמיד</button>
        </form>
      </div>

      <div className="card glass">
        <h3>סינון מהיר - Neon</h3>
        <form className="column-picker" method="GET">
          <input type="hidden" name="mode" value="institution" />
          {selectedColumnKeys.map((key) => (
            <input key={`institution-col-${key}`} type="hidden" name="cols" value={key} />
          ))}
          {sortLevels.map((level, index) => (
            <div key={`institution-sort-${index}`}>
              <input type="hidden" name="sby" value={level.sortBy} />
              <input type="hidden" name="sdir" value={level.sortDir} />
            </div>
          ))}
          {advancedFilters.map((filter, index) => (
            <div key={`institution-filter-${index}`}>
              <input type="hidden" name="ff" value={filter.field} />
              <input type="hidden" name="fo" value={filter.operator} />
              <input type="hidden" name="fv" value={filter.value} />
              <input type="hidden" name="fj" value={filter.joiner} />
              <input type="hidden" name="fg" value={filter.groupId || "group-1"} />
              <input type="hidden" name="gj" value={filter.groupJoiner || "AND"} />
            </div>
          ))}
          {missingType ? <input type="hidden" name="missingType" value={missingType} /> : null}
          <input type="hidden" name="pdfOrientation" value={pdfOrientation} />
          {pdfBlankColumnKeys.map((key) => (
            <input key={`institution-pdf-${key}`} type="hidden" name="pdfBlankCol" value={key} />
          ))}
          <div className="grid">
            {QUICK_FILTER_FIELDS.map((field) => {
              const selectedValues = field.paramName === "institution"
                ? selectedInstitutions
                : field.paramName === "quickRegistration"
                  ? selectedRegistrationCodes
                  : field.paramName === "quickClass"
                    ? selectedClassCodes
                    : field.paramName === "quickFamilyStatus"
                      ? selectedFamilyStatusCodes
                      : selectedHealthInsuranceCodes;

              return (
                <div key={field.paramName}>
                  {enumDropdownGroup(field.paramName, field.label, field.options, selectedValues)}
                </div>
              );
            })}
            <div>
              <details className="display-settings" open={selectedTagIds.length > 0}>
                <summary>{selectedTagIds.length ? `תגיות: ${selectedTagIds.length} נבחרו` : "תגיות: הכל"}</summary>
                <div className="column-grid" style={{ marginTop: 10 }}>
                  {!availableTags.length ? (
                    <div className="muted">עדיין לא נוצרו תגיות במערכת.</div>
                  ) : availableTags.map((tag) => (
                    <label key={tag.id} className="column-item">
                      <input type="checkbox" name="tag" value={tag.id} defaultChecked={selectedTagIds.includes(tag.id)} />
                      <span>{tag.name} ({tag.usageCount})</span>
                    </label>
                  ))}
                </div>
              </details>
            </div>
          </div>
          <div className="quick-actions">
            <button type="submit">החל סינון מהיר</button>
            <Link
              className="chip-link"
              href={buildNextPath({
                mode: "institution",
                cols: selectedColumnKeys,
                missingType,
                sby: sortLevels.map((level) => level.sortBy),
                sdir: sortLevels.map((level) => level.sortDir),
                ff: advancedFilters.map((filter) => filter.field),
                fo: advancedFilters.map((filter) => filter.operator),
                fv: advancedFilters.map((filter) => filter.value),
                fj: advancedFilters.map((filter) => filter.joiner),
                fg: advancedFilters.map((filter) => filter.groupId || "group-1"),
                gj: advancedFilters.map((filter) => filter.groupJoiner || "AND"),
                tag: selectedTagIds,
                pdfBlankCol: pdfBlankColumnKeys,
                pdfOrientation
              })}
            >
              נקה סינון מהיר
            </Link>
          </div>
        </form>
      </div>

      <details className="display-settings">
        <summary>עדכון מרוכז מאקסל</summary>
        <div className="display-settings-body">
          <p className="muted">
            העלה קובץ `xlsx`/`xls`/`csv`. בשלב הבא תועבר לעמוד מיפוי שבו תבחר איזו עמודה מזהה תלמיד ואיזו עמודה מעדכנת כל שדה.
            אין מיפוי אוטומטי חובה: כל קובץ יכול להגיע במבנה אחר, ואת ההתאמות תבחר ידנית.
          </p>
          <form action={prepareNeonStudentsImportAction} className="grid">
            <input type="file" name="file" accept=".xlsx,.xls,.csv" />
            <button type="submit">המשך לעמוד מיפוי אקסל</button>
          </form>
        </div>
      </details>

      {showInstitutionView ? (
        <>
          <div className="card summary-row">
            <div>סה"כ תלמידים בתצוגה: <b>{institutionCount}</b></div>
            <div>מיון פעיל: <b>{sortSummary}</b></div>
            <div className="quick-actions" style={{ marginTop: 0 }}>
              <Link className="chip-link" href={clearInstitutionFiltersPath}>נקה סינונים</Link>
              <a className="chip-link" href={exportHref}>ייצוא אקסל</a>
              <a className="chip-link" href={pdfExportHref}>ייצוא PDF</a>
            </div>
          </div>

          <div className="card">
            <details className="display-settings">
              <summary>מיון התצוגה</summary>
              <form method="GET" className="column-picker">
                <input type="hidden" name="mode" value="institution" />
                {hiddenValues("institution", selectedInstitutions)}
                <input type="hidden" name="institutionSearch" value={institutionSearch} />
                {hiddenValues("quickClass", selectedClassCodes)}
                {hiddenValues("quickRegistration", selectedRegistrationCodes)}
                {hiddenValues("quickFamilyStatus", selectedFamilyStatusCodes)}
                {hiddenValues("quickHealthInsurance", selectedHealthInsuranceCodes)}
                {hiddenValues("tag", selectedTagIds)}
                {selectedColumnKeys.map((key) => (
                  <input key={`sort-col-${key}`} type="hidden" name="cols" value={key} />
                ))}
                {advancedFilters.map((filter, index) => (
                  <div key={`sort-filter-${index}`}>
                    <input type="hidden" name="ff" value={filter.field} />
                    <input type="hidden" name="fo" value={filter.operator} />
                    <input type="hidden" name="fv" value={filter.value} />
                    <input type="hidden" name="fj" value={filter.joiner} />
                    <input type="hidden" name="fg" value={filter.groupId || "group-1"} />
                    <input type="hidden" name="gj" value={filter.groupJoiner || "AND"} />
                  </div>
                ))}
                {missingType ? <input type="hidden" name="missingType" value={missingType} /> : null}
                <input type="hidden" name="pdfOrientation" value={pdfOrientation} />
                {pdfBlankColumnKeys.map((key) => (
                  <input key={`sort-pdf-${key}`} type="hidden" name="pdfBlankCol" value={key} />
                ))}
                <p className="muted" style={{ margin: 0 }}>
                  אפשר לבחור עד 3 רמות מיון. מיון לפי "שם משפחה" ממיין קודם לפי שם המשפחה של התלמיד ואז לפי השם המלא.
                </p>
                <div className="grid">
                  {Array.from({ length: NEON_SORT_LEVEL_COUNT }).map((_, index) => {
                    const level = sortLevelAt(sortLevels, index);
                    return (
                      <div key={`sort-level-${index}`} className="card" style={{ padding: 12 }}>
                        <div style={{ marginBottom: 8, fontWeight: 700 }}>רמת מיון {index + 1}</div>
                        <select name="sby" defaultValue={level.sortBy || ""}>
                          <option value="">{index === 0 ? "בחר שדה מיון" : "ללא רמת מיון"}</option>
                          {NEON_SORT_OPTIONS.map((option) => (
                            <option key={`sort-level-${index}-${option.key}`} value={option.key}>{option.label}</option>
                          ))}
                        </select>
                        <select name="sdir" defaultValue={level.sortDir || "asc"}>
                          <option value="asc">מהקטן לגדול</option>
                          <option value="desc">מהגדול לקטן</option>
                        </select>
                      </div>
                    );
                  })}
                </div>
                <div className="quick-actions">
                  <button type="submit">עדכן מיון</button>
                  <Link
                    className="chip-link"
                    href={buildNextPath({
                      mode: "institution",
                      institution: selectedInstitutions,
                      institutionSearch,
                      cols: selectedColumnKeys,
                      quickClass: selectedClassCodes,
                      quickRegistration: selectedRegistrationCodes,
                      quickFamilyStatus: selectedFamilyStatusCodes,
                      quickHealthInsurance: selectedHealthInsuranceCodes,
                      tag: selectedTagIds,
                      missingType,
                      ff: advancedFilters.map((filter) => filter.field),
                      fo: advancedFilters.map((filter) => filter.operator),
                      fv: advancedFilters.map((filter) => filter.value),
                      fj: advancedFilters.map((filter) => filter.joiner),
                      fg: advancedFilters.map((filter) => filter.groupId || "group-1"),
                      gj: advancedFilters.map((filter) => filter.groupJoiner || "AND"),
                      pdfBlankCol: pdfBlankColumnKeys,
                      pdfOrientation
                    })}
                  >
                    חזור למיון ברירת מחדל
                  </Link>
                </div>
              </form>
            </details>
          </div>

          <div className="card">
            <details className="display-settings">
              <summary>שדות וחוסרים</summary>
              <form method="GET" className="column-picker">
                <input type="hidden" name="mode" value="institution" />
                {hiddenValues("institution", selectedInstitutions)}
                <input type="hidden" name="institutionSearch" value={institutionSearch} />
                {hiddenValues("quickClass", selectedClassCodes)}
                {hiddenValues("quickRegistration", selectedRegistrationCodes)}
                {hiddenValues("quickFamilyStatus", selectedFamilyStatusCodes)}
                {hiddenValues("quickHealthInsurance", selectedHealthInsuranceCodes)}
                {hiddenValues("tag", selectedTagIds)}
                <input type="hidden" name="pdfOrientation" value={pdfOrientation} />
                {pdfBlankColumnKeys.map((key) => (
                  <input key={`field-pdf-${key}`} type="hidden" name="pdfBlankCol" value={key} />
                ))}
                {sortLevels.map((level, index) => (
                  <div key={`sort-${index}`}>
                    <input type="hidden" name="sby" value={level.sortBy} />
                    <input type="hidden" name="sdir" value={level.sortDir} />
                  </div>
                ))}
                {advancedFilters.map((filter, index) => (
                  <div key={index}>
                    <input type="hidden" name="ff" value={filter.field} />
                    <input type="hidden" name="fo" value={filter.operator} />
                    <input type="hidden" name="fv" value={filter.value} />
                    <input type="hidden" name="fj" value={filter.joiner} />
                    <input type="hidden" name="fg" value={filter.groupId || "group-1"} />
                    <input type="hidden" name="gj" value={filter.groupJoiner || "AND"} />
                  </div>
                ))}
                <div className="grid">
                  <select name="missingType" defaultValue={missingType}>
                    <option value="">ללא סינון חוסרים</option>
                    <option value="contact">חוסר בהורה (טלפון+אימייל)</option>
                    <option value="identity">חוסר בת"ז או תאריך לידה</option>
                  </select>
                </div>
                <div className="column-grid">
                  {Object.values(INSTITUTION_COLUMN_MAP).map((col) => (
                    <label key={col.key} className="column-item">
                      <input type="checkbox" name="cols" value={col.key} defaultChecked={selectedColumnKeys.includes(col.key)} />
                      <span>{col.label}</span>
                    </label>
                  ))}
                </div>
                <button type="submit">עדכן תצוגה</button>
              </form>
            </details>
          </div>

          <div className="card">
            <details className="display-settings">
              <summary>הגדרות PDF להדפסה</summary>
              <form method="GET" className="column-picker">
                <input type="hidden" name="mode" value="institution" />
                {hiddenValues("institution", selectedInstitutions)}
                <input type="hidden" name="institutionSearch" value={institutionSearch} />
                {hiddenValues("quickClass", selectedClassCodes)}
                {hiddenValues("quickRegistration", selectedRegistrationCodes)}
                {hiddenValues("quickFamilyStatus", selectedFamilyStatusCodes)}
                {hiddenValues("quickHealthInsurance", selectedHealthInsuranceCodes)}
                {hiddenValues("tag", selectedTagIds)}
                {selectedColumnKeys.map((key) => (
                  <input key={`pdf-col-${key}`} type="hidden" name="cols" value={key} />
                ))}
                {sortLevels.map((level, index) => (
                  <div key={`pdf-sort-${index}`}>
                    <input type="hidden" name="sby" value={level.sortBy} />
                    <input type="hidden" name="sdir" value={level.sortDir} />
                  </div>
                ))}
                {advancedFilters.map((filter, index) => (
                  <div key={`pdf-filter-${index}`}>
                    <input type="hidden" name="ff" value={filter.field} />
                    <input type="hidden" name="fo" value={filter.operator} />
                    <input type="hidden" name="fv" value={filter.value} />
                    <input type="hidden" name="fj" value={filter.joiner} />
                    <input type="hidden" name="fg" value={filter.groupId || "group-1"} />
                    <input type="hidden" name="gj" value={filter.groupJoiner || "AND"} />
                  </div>
                ))}
                {missingType ? <input type="hidden" name="missingType" value={missingType} /> : null}
                <div className="grid">
                  <select name="pdfOrientation" defaultValue={pdfOrientation}>
                    <option value="portrait">אנכי</option>
                    <option value="landscape">אופקי</option>
                  </select>
                </div>
                <div className="column-grid">
                  {PDF_PRINT_ONLY_COLUMNS.map((column) => (
                    <label key={column.key} className="column-item">
                      <input type="checkbox" name="pdfBlankCol" value={column.key} defaultChecked={pdfBlankColumnKeys.includes(column.key)} />
                      <span>{column.label}</span>
                    </label>
                  ))}
                </div>
                <div className="quick-actions">
                  <button type="submit">עדכן תצוגת PDF</button>
                  <a className="chip-link" href={pdfExportHref}>הורד PDF</a>
                </div>
              </form>
            </details>
          </div>
        </>
      ) : null}

      {error ? <div className="card muted">{error}</div> : null}

      <BulkStudentsClient
        addStudentTagAction={addStudentTagFromSearchAction}
        addStudentContactAction={addStudentContactFromSearchAction}
        availableTags={availableTags}
        removeStudentTagAction={removeStudentTagFromSearchAction}
        students={students}
        selectedColumns={selectedColumns}
        showInstitutionView={showInstitutionView}
        showMatchScores={mode === "search" && Boolean(q)}
        returnTo={currentQueryString ? `/neon?${currentQueryString}` : "/neon"}
      />
    </>
  );
}
