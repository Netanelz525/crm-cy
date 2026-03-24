import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAppUser } from "../../lib/rbac";
import {
  applyAdvancedFilters,
  ageOf,
  buildMissingState,
  classLabel,
  clean,
  columnText,
  DEFAULT_INSTITUTION_COLUMN_KEYS,
  FIELD_DEF_MAP,
  getByPath,
  INSTITUTIONS,
  INSTITUTION_COLUMN_MAP,
  matchesMissingFilter,
  parseAdvancedFilters,
  parseListParam,
  parseSortLevels,
  phoneHref,
  phoneText,
  sanitizeQueryString,
  sortStudents
} from "../../lib/student-view";
import {
  getNeonStudentsByInstitution,
  getNeonStudentsStats,
  listAllNeonStudents,
  searchNeonStudentsByText,
  searchNeonStudentsByTz
} from "../../lib/neon-students";
import { syncNeonStudentsAction } from "./actions";

function PhoneLink({ phoneObj }) {
  const text = phoneText(phoneObj);
  if (text === "-") return "-";
  const href = phoneHref(phoneObj);
  if (!href) return text;
  return <a href={href}>{text}</a>;
}

function fieldPhoneHref(student, fieldKey) {
  const fieldDef = FIELD_DEF_MAP[fieldKey];
  if (!fieldDef || !fieldDef.key.endsWith(".primaryPhoneNumber")) return "";
  const phoneRoot = fieldDef.key.slice(0, -".primaryPhoneNumber".length);
  return phoneHref({
    primaryPhoneNumber: getByPath(student, fieldDef.key),
    primaryPhoneCallingCode: getByPath(student, `${phoneRoot}.primaryPhoneCallingCode`)
  });
}

function columnNode(student, columnKey) {
  if (columnKey.startsWith("field:")) {
    const fieldKey = columnKey.slice("field:".length);
    const value = columnText(student, columnKey);
    if (value === "-") return "-";
    const fieldDef = FIELD_DEF_MAP[fieldKey];
    if (fieldDef?.key.endsWith(".primaryPhoneNumber")) {
      const href = fieldPhoneHref(student, fieldKey);
      return href ? <a href={href}>{value}</a> : value;
    }
    if (fieldDef?.key.endsWith(".primaryEmail")) {
      const email = clean(getByPath(student, fieldKey));
      return email ? <a href={"mailto:" + email}>{email}</a> : value;
    }
    return value;
  }

  switch (columnKey) {
    case "name":
      return <Link className="student-link" href={`/neon/students/${student.id}`}>{clean(student?.label) || "-"}</Link>;
    case "studentPhone":
      return <PhoneLink phoneObj={student?.phone} />;
    case "dadPhone":
      return <PhoneLink phoneObj={student?.dadPhone} />;
    case "momPhone":
      return <PhoneLink phoneObj={student?.momPhone} />;
    case "studentEmail": {
      const email = clean(student?.email?.primaryEmail);
      return email ? <a href={"mailto:" + email}>{email}</a> : "-";
    }
    case "fatherEmail": {
      const email = clean(student?.fatherEmail?.primaryEmail);
      return email ? <a href={"mailto:" + email}>{email}</a> : "-";
    }
    case "motherEmail": {
      const email = clean(student?.motherEmail?.primaryEmail);
      return email ? <a href={"mailto:" + email}>{email}</a> : "-";
    }
    default:
      return columnText(student, columnKey);
  }
}

function buildQueryString(params) {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (Array.isArray(value)) {
      value.map(clean).filter(Boolean).forEach((item) => sp.append(key, item));
      continue;
    }
    const next = clean(value);
    if (next) sp.set(key, next);
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

export default async function NeonPage({ searchParams }) {
  const currentUser = await getCurrentAppUser();
  if (!currentUser) redirect("/sign-in");

  const resolvedSearchParams = await searchParams;

  if (!currentUser.is_team_member && !currentUser.is_manager) {
    if (currentUser.linked_student_id) redirect(`/neon/students/${currentUser.linked_student_id}`);
    redirect("/unauthorized");
  }

  const currentQueryString = sanitizeQueryString(buildQueryString(resolvedSearchParams));
  const institution = clean(resolvedSearchParams?.institution);
  const institutionSearch = clean(resolvedSearchParams?.institutionSearch);
  const missingOnly = clean(resolvedSearchParams?.missingOnly) === "1";
  const missingTypeParam = clean(resolvedSearchParams?.missingType).toLowerCase();
  const missingType = ["contact", "identity"].includes(missingTypeParam) ? missingTypeParam : (missingOnly ? "contact" : "");
  const sortLevels = parseSortLevels(resolvedSearchParams);
  const advancedFilters = parseAdvancedFilters(resolvedSearchParams);
  const synced = clean(resolvedSearchParams?.synced) === "1";
  const syncCount = clean(resolvedSearchParams?.count);

  const tz = clean(resolvedSearchParams?.tz).replace(/[^\d]/g, "");
  const q = clean(resolvedSearchParams?.q);
  const modeParam = clean(resolvedSearchParams?.mode).toLowerCase();
  const mode = modeParam || (institution || institutionSearch || missingOnly || missingType || advancedFilters.length ? "institution" : q || tz ? "search" : "");

  const parsedColumnKeys = parseListParam(resolvedSearchParams?.cols).filter((key) => INSTITUTION_COLUMN_MAP[key]);
  const selectedColumnKeys = parsedColumnKeys.length ? parsedColumnKeys : DEFAULT_INSTITUTION_COLUMN_KEYS;
  const selectedColumns = selectedColumnKeys.map((key) => INSTITUTION_COLUMN_MAP[key]).filter(Boolean);

  let students = [];
  let error = "";

  try {
    if (mode === "institution" && (institution || advancedFilters.length)) {
      const scopedInstitutionCode = institution || findInstitutionCode(
        advancedFilters.find((filter) => clean(filter.field) === "institution" && filter.operator === "equals")?.value
      );

      if (scopedInstitutionCode) {
        students = await getNeonStudentsByInstitution(scopedInstitutionCode);
      } else {
        students = await listAllNeonStudents();
      }

      if (institutionSearch) {
        const term = institutionSearch.toLowerCase();
        students = students.filter((student) => clean(student.label).toLowerCase().includes(term));
      }

      students = students.map((student) => {
        const missingState = buildMissingState(student);
        return { ...student, missingItems: missingState.items, missingFlags: missingState.flags };
      });

      if (missingType) students = students.filter((student) => matchesMissingFilter({ flags: student.missingFlags }, missingType));
      students = applyAdvancedFilters(students, advancedFilters);
      students = sortStudents(students, sortLevels);
    } else if (mode === "search") {
      if (tz) students = (await searchNeonStudentsByTz(tz)).slice(0, 10);
      else if (q) students = await searchNeonStudentsByText(q, 10);
    }
  } catch (e) {
    error = e.message || "Search failed";
  }

  const stats = await getNeonStudentsStats();
  const clearInstitutionFiltersPath = buildNextPath({ mode: "institution", institution, cols: selectedColumnKeys });
  const exportHref = currentQueryString ? `/api/export/institution?source=neon&${currentQueryString}` : "/api/export/institution?source=neon";
  const hasInstitutionFilter = hasInstitutionScopedFilter(advancedFilters);
  const institutionCount = students.length;

  return (
    <>
      <div className="card glass">
        <div className="student-topbar">
          <div>
            <h1>Neon Students Beta</h1>
            <p className="muted">טאב מקביל שעובד מול עותק הנתונים ב-Neon, עם עריכה שמסנכרנת חזרה ל-Twenty.</p>
          </div>
          <div className="student-actions student-actions-wrap">
            <Link className="btn btn-ghost" href="/">חזרה לגרסה הראשית</Link>
            <form action={syncNeonStudentsAction}>
              <button className="btn btn-primary" type="submit">סנכרון מ-Twenty</button>
            </form>
          </div>
        </div>
        <div className="student-meta-line">
          <span className="meta-chip">תלמידים במראה: {stats.total || 0}</span>
          <span className="meta-chip">סנכרון אחרון: {stats.last_synced_at ? new Date(stats.last_synced_at).toLocaleString("he-IL") : "עדיין לא בוצע"}</span>
        </div>
      </div>

      {synced ? <div className="ok">הסנכרון הושלם. עודכנו {syncCount || 0} תלמידים.</div> : null}

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
        <h3>תצוגת מוסד - Neon</h3>
        <form className="grid" method="GET">
          <input type="hidden" name="mode" value="institution" />
          <select name="institution" defaultValue={mode === "institution" ? institution : ""}>
            <option value="">בחר מוסד</option>
            {Object.entries(INSTITUTIONS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <input name="institutionSearch" defaultValue={mode === "institution" ? institutionSearch : ""} placeholder="חיפוש בתוך מוסד" />
          <button type="submit">הצג מוסד</button>
        </form>
      </div>

      {mode === "institution" && (institution || hasInstitutionFilter || advancedFilters.length) ? (
        <>
          <div className="card summary-row">
            <div>סה"כ תלמידים בתצוגה: <b>{institutionCount}</b></div>
            <div className="quick-actions" style={{ marginTop: 0 }}>
              <Link className="chip-link" href={clearInstitutionFiltersPath}>נקה סינונים</Link>
              <a className="chip-link" href={exportHref}>ייצוא אקסל</a>
            </div>
          </div>

          <div className="card">
            <details className="display-settings">
              <summary>שדות וחוסרים</summary>
              <form method="GET" className="column-picker">
                <input type="hidden" name="mode" value="institution" />
                <input type="hidden" name="institution" value={institution} />
                <input type="hidden" name="institutionSearch" value={institutionSearch} />
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
        </>
      ) : null}

      {error ? <div className="card muted">{error}</div> : null}

      <div className="card desktop-table">
        <table>
          <thead>
            {mode === "institution" && (institution || hasInstitutionFilter || advancedFilters.length) ? (
              <tr>
                {selectedColumns.map((col) => <th key={col.key}>{col.label}</th>)}
              </tr>
            ) : (
              <tr>
                <th>שם</th>
                <th>שיעור</th>
                <th>ת"ז</th>
                <th>גיל</th>
                <th>טלפון תלמיד</th>
                <th>טלפון אב</th>
                <th>טלפון אם</th>
                <th>חוסרים</th>
              </tr>
            )}
          </thead>
          <tbody>
            {!students.length ? (
              <tr>
                <td colSpan={mode === "institution" && (institution || hasInstitutionFilter || advancedFilters.length) ? Math.max(selectedColumns.length, 1) : 8} className="muted">אין תוצאות</td>
              </tr>
            ) : mode === "institution" && (institution || hasInstitutionFilter || advancedFilters.length) ? (
              students.map((student) => {
                const hasMissing = (student.missingItems || []).length > 0;
                return (
                  <tr key={student.id} style={hasMissing ? { background: "#fff1f2" } : undefined}>
                    {selectedColumns.map((col) => (
                      <td key={col.key} style={col.key === "missing" && hasMissing ? { color: "#b42318", fontWeight: 700 } : undefined}>
                        {columnNode(student, col.key)}
                      </td>
                    ))}
                  </tr>
                );
              })
            ) : (
              students.map((student) => {
                const missingState = buildMissingState(student);
                const hasMissing = missingState.items.length > 0;
                return (
                  <tr key={student.id} style={hasMissing ? { background: "#fff1f2" } : undefined}>
                    <td><Link className="student-link" href={`/neon/students/${student.id}`}>{student.label}</Link></td>
                    <td>{classLabel(student.class)}</td>
                    <td>{student.tznum || "-"}</td>
                    <td>{ageOf(student.dateofbirth) ?? "-"}</td>
                    <td><PhoneLink phoneObj={student.phone} /></td>
                    <td><PhoneLink phoneObj={student.dadPhone} /></td>
                    <td><PhoneLink phoneObj={student.momPhone} /></td>
                    <td style={hasMissing ? { color: "#b42318", fontWeight: 700 } : undefined}>{hasMissing ? missingState.items.join(", ") : "-"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="mobile-student-list">
        {!students.length ? (
          <div className="card muted">אין תוצאות</div>
        ) : mode === "institution" && (institution || hasInstitutionFilter || advancedFilters.length) ? (
          students.map((student) => {
            const hasMissing = (student.missingItems || []).length > 0;
            return (
              <div key={student.id} className={`student-mobile-card ${hasMissing ? "missing" : ""}`}>
                <div className="student-mobile-head">
                  <Link className="student-link" href={`/neon/students/${student.id}`}>{student.label}</Link>
                </div>
                <div className="student-mobile-grid">
                  {selectedColumns.map((col) => <div key={col.key}><b>{col.label}:</b> {columnNode(student, col.key)}</div>)}
                </div>
              </div>
            );
          })
        ) : (
          students.map((student) => {
            const missingState = buildMissingState(student);
            const hasMissing = missingState.items.length > 0;
            return (
              <div key={student.id} className={`student-mobile-card ${hasMissing ? "missing" : ""}`}>
                <div className="student-mobile-head">
                  <Link className="student-link" href={`/neon/students/${student.id}`}>{student.label}</Link>
                  <span>{classLabel(student.class)}</span>
                </div>
                <div className="student-mobile-grid">
                  <div><b>ת"ז:</b> {student.tznum || "-"}</div>
                  <div><b>גיל:</b> {ageOf(student.dateofbirth) ?? "-"}</div>
                  <div><b>טלפון תלמיד:</b> <PhoneLink phoneObj={student.phone} /></div>
                  <div><b>טלפון אב:</b> <PhoneLink phoneObj={student.dadPhone} /></div>
                  <div><b>טלפון אם:</b> <PhoneLink phoneObj={student.momPhone} /></div>
                </div>
                <div className="student-mobile-missing"><b>חוסרים:</b> {hasMissing ? missingState.items.join(", ") : "-"}</div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
