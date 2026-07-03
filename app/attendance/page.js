import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ATTENDANCE_SELECTABLE_SESSION_TYPE_ORDER,
  ATTENDANCE_SUMMARY_SORT_LABELS,
  ATTENDANCE_SESSION_TYPE_LABELS,
  ATTENDANCE_SESSION_TYPE_ORDER,
  getAttendanceSummaryReport,
  listAttendanceResponsibleUsers,
  listAttendanceSessions
} from "../../lib/attendance";
import { ENUM_LABELS } from "../../lib/student-fields";
import { getCurrentAppUser } from "../../lib/rbac";
import { listStudentTags } from "../../lib/student-tags";
import { CLASS_LABELS, INSTITUTIONS } from "../../lib/student-view";
import { createAttendanceSessionAction, deleteAttendanceSessionAction, setAttendanceSessionLockAction, setAttendanceSessionsBulkLockAction } from "./actions";
import ResponsibleUserPicker from "./responsible-user-picker";

function clean(value) {
  return String(value || "").trim();
}

function formatSessionLabel(session) {
  const title = clean(session?.displayTitle || session?.title || session?.sessionTypeLabel);
  const institutionLabel = clean(session?.institutionLabel);
  const sessionDate = clean(session?.sessionDate);
  return [institutionLabel, title, sessionDate].filter(Boolean).join(" | ");
}

function formatSessionMeta(session) {
  const parts = [
    clean(session?.sessionWeekdayLabel),
    clean(session?.sessionHebrewDateLabel)
  ].filter(Boolean);
  return parts.join(" | ");
}

function formatSessionAudience(session) {
  const institutionLabels = (session?.institutionFilterOptions || []).map((item) => item.label);
  const classLabels = (session?.classFilterOptions || []).map((item) => item.label);
  const registrationLabels = (session?.registrationFilterOptions || []).map((item) => item.label);
  const familyStatusLabels = (session?.familyStatusFilterOptions || []).map((item) => item.label);
  const tagLabels = (session?.tagFilterOptions || []).map((item) => item.label);
  const parts = [];
  if (institutionLabels.length) parts.push(`מוסדות: ${institutionLabels.join(", ")}`);
  if (classLabels.length) parts.push(`שיעורים: ${classLabels.join(", ")}`);
  if (registrationLabels.length) parts.push(`רישום: ${registrationLabels.join(", ")}`);
  if (familyStatusLabels.length) parts.push(`סטטוס משפחתי: ${familyStatusLabels.join(", ")}`);
  if (tagLabels.length) parts.push(`תוויות: ${tagLabels.join(", ")}`);
  return parts.join(" | ");
}

function checkboxOptionsFromMap(options) {
  return Object.entries(options || {}).map(([value, label]) => ({ value, label }));
}

function FilterCheckboxFieldset({ legend, name, options, helperText = "" }) {
  return (
    <div className="email-filter-fieldset" style={{ padding: 14 }}>
      <div className="email-filter-fieldset-head" style={{ padding: 0, marginBottom: 10, cursor: "default" }}>
        <div className="email-filter-fieldset-title">
          <span className="email-filter-legend">{legend}</span>
          <span className="email-filter-count">אופציונלי</span>
        </div>
        <div className="email-filter-fieldset-meta">
          <span className="email-filter-inline-summary">{helperText || "בחר ערכים למפגש"}</span>
        </div>
      </div>
      <div className="email-filter-fieldset-body" style={{ padding: 0, borderTop: "none" }}>
        <div className="email-filter-chip-list">
          {options.map((option) => (
            <label key={`${name}-${option.value}`} className="email-filter-chip">
              <input type="checkbox" className="email-filter-chip-input" name={name} value={option.value} />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

function SessionTypeFieldset({ options, defaultValue = "" }) {
  return (
    <div className="attendance-session-type-fieldset">
      <div className="attendance-session-type-head">
        <span>סוג מפגש</span>
        <small>בחירת סוג המפגש עצמו</small>
      </div>
      <div className="attendance-session-type-list">
        {options.map((value) => (
          <label key={value} className="attendance-session-type-chip">
            <input
              type="radio"
              name="sessionType"
              value={value}
              defaultChecked={defaultValue === value}
            />
            <span>{ATTENDANCE_SESSION_TYPE_LABELS[value]}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function inputDateFromDate(date) {
  const copy = new Date(date);
  copy.setHours(12, 0, 0, 0);
  return copy.toISOString().slice(0, 10);
}

function startOfWeek(date) {
  const copy = new Date(date);
  copy.setHours(12, 0, 0, 0);
  copy.setDate(copy.getDate() - copy.getDay());
  return copy;
}

function startOfMonth(date) {
  const copy = new Date(date);
  copy.setHours(12, 0, 0, 0);
  copy.setDate(1);
  return copy;
}

function formatPercent(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return "0%";
  return `${numeric % 1 === 0 ? numeric.toFixed(0) : numeric.toFixed(1)}%`;
}

function buildSummaryExportQuery(filters) {
  const params = new URLSearchParams();
  if (filters.institution) params.set("reportInstitution", filters.institution);
  if (filters.start) params.set("reportStart", filters.start);
  if (filters.end) params.set("reportEnd", filters.end);
  if (filters.sort) params.set("reportSort", filters.sort);
  return params.toString();
}

function buildAttendanceReturnPath(searchParams) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams || {})) {
    if (key === "lockSaved" || key === "bulkLockSaved" || key === "bulkLockCount") continue;
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item !== undefined && item !== null) params.append(key, String(item));
      });
      continue;
    }
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `/attendance?${query}` : "/attendance";
}

function getSearchParamList(value) {
  return (Array.isArray(value) ? value : [value]).map(clean).filter(Boolean);
}

function resolveReportFilters(searchParams) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const monthStart = inputDateFromDate(startOfMonth(today));
  const weekStart = inputDateFromDate(startOfWeek(today));
  const todayValue = inputDateFromDate(today);
  const range = clean(searchParams?.reportRange) || "month";
  const institution = clean(searchParams?.reportInstitution);
  const sort = clean(searchParams?.reportSort).toLowerCase() || "class_name";

  if (range === "week") {
    return {
      institution,
      range,
      start: weekStart,
      end: todayValue,
      sort
    };
  }

  if (range === "custom") {
    return {
      institution,
      range,
      start: clean(searchParams?.reportStart) || monthStart,
      end: clean(searchParams?.reportEnd) || todayValue,
      sort
    };
  }

  return {
    institution,
    range: "month",
    start: monthStart,
    end: todayValue,
    sort
  };
}

export default async function AttendancePage({ searchParams }) {
  const currentUser = await getCurrentAppUser();
  if (!currentUser) redirect("/sign-in");
  if (!currentUser.is_team_member && !currentUser.is_manager && !currentUser.is_super_admin) redirect("/unauthorized");
  const canUseSessionAudienceFilters = true;
  const canManageSessionLock = currentUser.is_manager || currentUser.is_super_admin;

  const resolvedSearchParams = await searchParams;
  const created = clean(resolvedSearchParams?.created) === "1";
  const deleted = clean(resolvedSearchParams?.deleted) === "1";
  const lockSaved = clean(resolvedSearchParams?.lockSaved);
  const bulkLockSaved = clean(resolvedSearchParams?.bulkLockSaved);
  const bulkLockCount = Number(clean(resolvedSearchParams?.bulkLockCount) || 0) || 0;
  const attendanceReturnPath = buildAttendanceReturnPath(resolvedSearchParams);
  const reportFilters = resolveReportFilters(resolvedSearchParams);
  const summaryExportQuery = buildSummaryExportQuery(reportFilters);
  const responsibleParam = getSearchParamList(resolvedSearchParams?.responsible);
  const responsibleFilterMode = responsibleParam.includes("all") ? "all" : "selected";
  const selectedResponsibleIds = responsibleFilterMode === "all"
    ? []
    : (responsibleParam.length ? responsibleParam : [clean(currentUser.clerk_user_id)].filter(Boolean));
  const sessions = await listAttendanceSessions(
    reportFilters.institution
      ? {
          institution: reportFilters.institution,
          dateFrom: reportFilters.start,
          dateTo: reportFilters.end,
          responsibleUserIds: selectedResponsibleIds,
          limit: 1000
        }
      : { responsibleUserIds: selectedResponsibleIds, limit: 1000 }
  );
  const [responsibleUsers, availableTags] = await Promise.all([listAttendanceResponsibleUsers(), listStudentTags()]);
  const summaryReport = reportFilters.institution
    ? await getAttendanceSummaryReport({
        institution: reportFilters.institution,
        dateFrom: reportFilters.start,
        dateTo: reportFilters.end,
        sort: reportFilters.sort
      })
    : null;
  const institutionOptions = checkboxOptionsFromMap(INSTITUTIONS);
  const classOptions = checkboxOptionsFromMap(CLASS_LABELS);
  const registrationOptions = checkboxOptionsFromMap(ENUM_LABELS.registration || {});
  const familyStatusOptions = checkboxOptionsFromMap(ENUM_LABELS.familystatus || {});
  const tagOptions = availableTags.map((tag) => ({ value: tag.id, label: tag.name }));
  const selectableSessionTypes = ATTENDANCE_SELECTABLE_SESSION_TYPE_ORDER;
  const defaultSessionType = "";

  return (
    <>
      <div className="card glass">
        <h1>נוכחות מוסדית</h1>
        <p className="muted">
          יוצרים מפגש לפי מוסד, פותחים את רשימת התלמידים של אותו מוסד, ומזינים את הנוכחות מהתיעוד הקיים.
        </p>
        <div className="quick-actions">
          <Link className="quick-action-btn quick-action-outline" href="/">חזרה לתלמידים</Link>
          <Link className="quick-action-btn quick-action-outline" href="/neon">חזרה ל-Neon</Link>
        </div>
      </div>

      <section className="card glass">
        <h3>סיכום נוכחות</h3>
        <p className="muted">
          דוח מסכם לפי מוסד וטווח תאריכים, עם עמודה לכל סוג מפגש ואחוז נוכחות כולל לכל תלמיד.
        </p>
        <form className="grid" method="get">
          <select name="reportInstitution" defaultValue={reportFilters.institution} required>
            <option value="">בחר מוסד לדוח</option>
            {Object.entries(INSTITUTIONS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select name="reportRange" defaultValue={reportFilters.range}>
            <option value="week">שבוע נוכחי</option>
            <option value="month">חודש נוכחי</option>
            <option value="custom">מותאם אישית</option>
          </select>
          <select name="reportSort" defaultValue={reportFilters.sort}>
            {Object.entries(ATTENDANCE_SUMMARY_SORT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <input name="reportStart" type="date" defaultValue={reportFilters.start} />
          <input name="reportEnd" type="date" defaultValue={reportFilters.end} />
          <button type="submit">הצג סיכום</button>
        </form>
      </section>

      {summaryReport ? (
        <section className="card">
          <div className="summary-row">
            <div>
              <h3 style={{ marginBottom: 6 }}>סיכום עבור {summaryReport.institutionLabel}</h3>
              <div className="muted">
                טווח: {summaryReport.dateFrom} עד {summaryReport.dateTo} | מיון: {ATTENDANCE_SUMMARY_SORT_LABELS[reportFilters.sort] || ATTENDANCE_SUMMARY_SORT_LABELS.class_name}
              </div>
            </div>
            <div className="attendance-stats">
              <span className="meta-chip">תלמידים: {summaryReport.totalStudents}</span>
              <span className="meta-chip">מפגשים: {summaryReport.totalSessions}</span>
              {summaryReport.sessionTypeTotals.map((item) => (
                <span key={item.sessionType} className="meta-chip">{item.label}: {item.totalSessions}</span>
              ))}
            </div>
          </div>

          {summaryReport.totalSessions ? (
            <div className="quick-actions" style={{ marginTop: 14 }}>
              <a className="quick-action-btn quick-action-primary" href={`/api/attendance/summary/xlsx?${summaryExportQuery}`}>
                הורד אקסל
              </a>
              <a className="quick-action-btn quick-action-outline" href={`/api/attendance/summary/pdf?${summaryExportQuery}`} target="_blank" rel="noreferrer">
                הורד PDF
              </a>
            </div>
          ) : null}

          {!summaryReport.totalSessions ? (
            <div className="card muted" style={{ marginTop: 14, marginBottom: 0 }}>
              לא נמצאו מפגשים בטווח התאריכים שנבחר.
            </div>
          ) : (
            <div className="attendance-table-wrap" style={{ marginTop: 14 }}>
              <table className="attendance-table attendance-summary-table">
                <thead>
                  <tr>
                    <th>שם תלמיד</th>
                    <th>שיעור</th>
                    {ATTENDANCE_SESSION_TYPE_ORDER.map((sessionType) => (
                      <th key={sessionType}>{ATTENDANCE_SESSION_TYPE_LABELS[sessionType]}</th>
                    ))}
                    <th>אחוז מסכם</th>
                  </tr>
                </thead>
                <tbody>
                  {summaryReport.rows.map((student) => (
                    <tr key={student.id}>
                      <td>
                        <div className="attendance-student-name">{student.label}</div>
                      </td>
                      <td>{student.classLabel}</td>
                      {ATTENDANCE_SESSION_TYPE_ORDER.map((sessionType) => (
                        <td key={sessionType}>
                          <div className="attendance-summary-cell">
                            <strong>{student.byType[sessionType].displayValue}</strong>
                            <span>{formatPercent(student.byType[sessionType].percent)}</span>
                          </div>
                        </td>
                      ))}
                      <td>
                        <div className="attendance-summary-cell">
                          <strong>{student.overall.displayValue}</strong>
                          <span>{formatPercent(student.overall.percent)}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {created ? <div className="ok">המפגש נוצר ונפתח להזנת נוכחות.</div> : null}
      {deleted ? <div className="ok">המפגש נמחק.</div> : null}
      {lockSaved === "locked" ? <div className="ok">המפגש ננעל לעדכונים.</div> : null}
      {lockSaved === "unlocked" ? <div className="ok">נעילת המפגש נפתחה.</div> : null}
      {bulkLockSaved === "locked" ? <div className="ok">ננעלו {bulkLockCount} מפגשים מהרשימה.</div> : null}
      {bulkLockSaved === "unlocked" ? <div className="ok">נפתחה הנעילה עבור {bulkLockCount} מפגשים מהרשימה.</div> : null}
      <div className="attendance-layout">
        <section className="card glass">
          <h3>יצירת מפגש חדש</h3>
          <form action={createAttendanceSessionAction} className="grid">
            <input type="hidden" name="institution" value="" />
            <label style={{ gridColumn: "1 / -1" }}>
              <span className="muted">מבנה ממפגש קודם</span>
              <select name="templateSessionId" defaultValue="">
                <option value="">יצירה רגילה ללא העתקת מבנה</option>
                {sessions.map((session) => (
                  <option key={`template-${session.id}`} value={session.id}>
                    {formatSessionLabel(session)}
                    {session.responsibleDisplayName ? ` | אחראים: ${session.responsibleDisplayName}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <SessionTypeFieldset options={selectableSessionTypes} defaultValue={defaultSessionType} />
            <input name="title" placeholder="שם חופשי למפגש, למשל: ביקורת ערב" />
            <input name="sessionDate" type="date" defaultValue={todayInputValue()} required />
            <textarea name="sourceNote" placeholder="הערת מקור או תיעוד חופשי מהדף" />
            {canUseSessionAudienceFilters ? (
              <>
                <ResponsibleUserPicker users={responsibleUsers} defaultValues={[currentUser.clerk_user_id]} />
                <label className="attendance-visibility-toggle">
                  <input type="checkbox" name="visibleToStudents" value="1" />
                  <span className="attendance-visibility-box" aria-hidden="true" />
                  <span>
                    <strong>גלוי לתלמידים</strong>
                    <small>כבוי כברירת מחדל. כשהתיבה מסומנת, תלמידים יראו את המפגש בכרטיס האישי.</small>
                  </span>
                </label>
                <div style={{ gridColumn: "1 / -1" }}>
                  <div className="muted" style={{ marginBottom: 10 }}>
                    אפשר ליצור מפגש לפי קהל יעד מסונן. אם לא תבחר מסננים, ייכללו כל תלמידי המוסד. לסופר אדמין בלי מוסד ובלי מסנן מוסדות, המפגש יחול על כל המוסדות.
                  </div>
                  <div className="email-form-grid">
                    <FilterCheckboxFieldset legend="מוסדות" name="institutionFilter" options={institutionOptions} helperText="אם לא נבחר מוסד, המפגש יחול על כל המוסדות." />
                    <FilterCheckboxFieldset legend="שיעורים" name="classFilter" options={classOptions} />
                    <FilterCheckboxFieldset legend="רישום" name="registrationFilter" options={registrationOptions} />
                    <FilterCheckboxFieldset legend="סטטוס משפחתי" name="familyStatusFilter" options={familyStatusOptions} />
                    <FilterCheckboxFieldset legend="תוויות" name="tagFilter" options={tagOptions} helperText="הוסף למפגש רק תלמידים עם אחת מהתוויות שנבחרו" />
                  </div>
                </div>
              </>
            ) : null}
            <button type="submit">צור מפגש והתחל להזין</button>
          </form>
        </section>

        <aside className="card glass">
          <h3>{reportFilters.institution ? "כל המפגשים לפי הסינון" : "כל המפגשים"}</h3>
          <form method="get" className="attendance-responsible-filter">
            <div className="attendance-responsible-filter-head">
              <b>סינון לפי אחראים</b>
              <span className="muted">ברירת מחדל: מפגשים באחריותי</span>
            </div>
            <div className="email-filter-chip-list">
              {responsibleUsers.map((user) => (
                <label key={`responsible-filter-${user.id}`} className="email-filter-chip">
                  <input
                    type="checkbox"
                    className="email-filter-chip-input"
                    name="responsible"
                    value={user.id}
                    defaultChecked={responsibleFilterMode !== "all" && selectedResponsibleIds.includes(user.id)}
                  />
                  <span>{user.displayName}</span>
                </label>
              ))}
            </div>
            <div className="quick-actions" style={{ marginTop: 8 }}>
              <button type="submit" className="quick-action-btn quick-action-outline">החל סינון</button>
              <Link className="quick-action-btn quick-action-primary" href="/attendance">באחריותי</Link>
              <Link className="quick-action-btn quick-action-outline" href="/attendance?responsible=all">כל המפגשים</Link>
            </div>
          </form>
          {canManageSessionLock && sessions.length ? (
            <div className="quick-actions" style={{ marginTop: 10 }}>
              <form action={setAttendanceSessionsBulkLockAction} className="quick-actions" style={{ marginTop: 0 }}>
                <input type="hidden" name="locked" value="1" />
                <input type="hidden" name="returnPath" value={attendanceReturnPath} />
                {sessions.map((session) => (
                  <input key={`bulk-lock-${session.id}`} type="hidden" name="sessionIds" value={session.id} />
                ))}
                <button type="submit" className="quick-action-btn quick-action-outline">נעל את כל הרשימה</button>
              </form>
              <form action={setAttendanceSessionsBulkLockAction} className="quick-actions" style={{ marginTop: 0 }}>
                <input type="hidden" name="locked" value="0" />
                <input type="hidden" name="returnPath" value={attendanceReturnPath} />
                {sessions.map((session) => (
                  <input key={`bulk-unlock-${session.id}`} type="hidden" name="sessionIds" value={session.id} />
                ))}
                <button type="submit" className="quick-action-btn quick-action-primary">פתח את כל הרשימה</button>
              </form>
            </div>
          ) : null}
          {!sessions.length ? (
            <p className="muted">
              {reportFilters.institution
                ? "לא נמצאו מפגשים שתואמים לפילטרים של הדוח."
                : "עדיין לא נוצרו מפגשי נוכחות."}
            </p>
          ) : (
            <div className="attendance-session-list">
              {sessions.map((session) => (
                <div key={session.id} className="attendance-session-link">
                  <Link href={`/attendance/${session.id}`}>
                    <strong>{formatSessionLabel(session)}</strong>
                    {formatSessionMeta(session) ? <span>{formatSessionMeta(session)}</span> : null}
                    <span>נוצר על ידי: {session.createdByDisplayName}</span>
                    <span>אחראי: {session.responsibleDisplayName || "לא הוגדר"}</span>
                    <span>{session.isLocked ? "נעול לעדכונים" : "פתוח לעדכונים"}</span>
                    <span>{session.visibleToStudents ? "גלוי לתלמידים" : "מוסתר מתלמידים"}</span>
                    {formatSessionAudience(session) ? <span>{formatSessionAudience(session)}</span> : null}
                    {session.sourceNote ? <span>{session.sourceNote}</span> : <span>{session.id}</span>}
                  </Link>
                  {canManageSessionLock ? (
                    <form action={setAttendanceSessionLockAction}>
                      <input type="hidden" name="sessionId" value={session.id} />
                      <input type="hidden" name="locked" value={session.isLocked ? "0" : "1"} />
                      <input type="hidden" name="returnPath" value={attendanceReturnPath} />
                      <button type="submit" className={session.isLocked ? "quick-action-btn quick-action-primary" : "quick-action-btn quick-action-outline"}>
                        {session.isLocked ? "פתח נעילה" : "נעל"}
                      </button>
                    </form>
                  ) : null}
                  <form action={deleteAttendanceSessionAction}>
                    <input type="hidden" name="sessionId" value={session.id} />
                    <button type="submit" className="quick-action-btn quick-action-outline">מחק</button>
                  </form>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
      <div className="card muted">בחר מפגש קיים או צור מפגש חדש כדי להתחיל להזין נוכחות.</div>
    </>
  );
}
