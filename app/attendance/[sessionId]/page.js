import Link from "next/link";
import { redirect } from "next/navigation";
import AttendanceRosterClient from "../attendance-roster-client";
import AttendanceEmailSendSubmit from "../attendance-email-send-submit";
import {
  saveAttendanceSessionDetailsAction,
  saveAttendanceSessionStatusesAction,
  saveAttendanceSessionMessagingAction,
  sendAttendanceSessionEmailsAction,
  setAttendanceSessionLockAction,
  syncAttendanceSessionStudentsAction
} from "../actions";
import {
  ATTENDANCE_EMAIL_RECIPIENT_LABELS,
  ATTENDANCE_SELECTABLE_SESSION_TYPE_ORDER,
  ATTENDANCE_SESSION_TYPE_LABELS,
  getAttendanceRoster,
  listAttendanceResponsibleUsers
} from "../../../lib/attendance";
import { ATTENDANCE_EXPORT_SORT_LABELS as PDF_SORT_LABELS } from "../../../lib/attendance-exports";
import { getCurrentAppUser } from "../../../lib/rbac";
import { listStudentTags } from "../../../lib/student-tags";
import ResponsibleUserPicker from "../responsible-user-picker";

function clean(value) {
  return String(value || "").trim();
}

function serializeCustomStatuses(customStatuses = []) {
  return (customStatuses || [])
    .map((item) => `${item.value}|${item.label}`)
    .join("\n");
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

export default async function AttendanceSessionPage({ params, searchParams }) {
  const currentUser = await getCurrentAppUser();
  if (!currentUser) redirect("/sign-in");
  if (!currentUser.is_team_member && !currentUser.is_manager && !currentUser.is_super_admin) redirect("/unauthorized");

  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const sessionId = clean(resolvedParams?.sessionId);
  const created = clean(resolvedSearchParams?.created) === "1";
  const synced = clean(resolvedSearchParams?.synced) === "1";
  const detailsSaved = clean(resolvedSearchParams?.detailsSaved) === "1";
  const statusesSaved = clean(resolvedSearchParams?.statusesSaved) === "1";
  const messageSaved = clean(resolvedSearchParams?.messageSaved) === "1";
  const lockSaved = clean(resolvedSearchParams?.lockSaved);
  const mailQueued = clean(resolvedSearchParams?.mailQueued) === "1";
  const mailSent = clean(resolvedSearchParams?.mailSent) === "1";
  const sentEmails = clean(resolvedSearchParams?.sentEmails);
  const failedEmails = clean(resolvedSearchParams?.failedEmails);
  const mailError = clean(resolvedSearchParams?.mailError);
  const activeStatusFilters = clean(resolvedSearchParams?.statusFilter)
    .split(",")
    .map((value) => clean(value).toLowerCase())
    .filter(Boolean);
  const exportSort = clean(resolvedSearchParams?.exportSort).toLowerCase() || "class_name";
  const roster = sessionId ? await getAttendanceRoster(sessionId) : null;
  const statusOptions = Array.isArray(roster?.session?.statusOptions) ? roster.session.statusOptions : [];
  const canManageSessionLock = currentUser.is_manager || currentUser.is_super_admin;
  const canManageSessionSettings = currentUser.is_manager || currentUser.is_super_admin;
  const [responsibleUsers, availableTags] = canManageSessionSettings
    ? await Promise.all([listAttendanceResponsibleUsers(), listStudentTags()])
    : [[], []];

  if (!roster) {
    return (
      <>
        <div className="card glass">
          <h1>מפגש נוכחות</h1>
          <p className="muted">לא נמצא מפגש נוכחות תואם.</p>
          <div className="quick-actions">
            <Link className="quick-action-btn quick-action-outline" href="/attendance">חזרה למפגשים</Link>
          </div>
        </div>
      </>
    );
  }

  const sessionAudienceSummary = formatSessionAudience(roster.session);
  const sessionSummary = [
    roster.session.institutionLabel,
    roster.session.displayTitle || roster.session.title || roster.session.sessionTypeLabel || "ללא סוג",
    roster.session.sessionDate,
    roster.session.sessionWeekdayLabel,
    roster.session.sessionHebrewDateLabel,
    roster.session.isLocked ? "נעול" : "פתוח לעדכונים",
    roster.session.visibleToStudents ? "גלוי לתלמידים" : "מוסתר מתלמידים",
    roster.session.responsibleDisplayName ? `אחראי: ${roster.session.responsibleDisplayName}` : "",
    sessionAudienceSummary
  ].filter(Boolean).join(" | ");

  return (
    <>
      <div className="card glass">
        <h1>מפגש נוכחות</h1>
        <div className="quick-actions">
          <Link className="quick-action-btn quick-action-outline" href="/attendance">חזרה למפגשים</Link>
          <form action={syncAttendanceSessionStudentsAction} className="quick-actions" style={{ marginTop: 0 }}>
            <input type="hidden" name="sessionId" value={roster.session.id} />
            <button type="submit" className="quick-action-btn quick-action-outline">סנכרן תלמידים</button>
          </form>
          {canManageSessionLock ? (
            <form action={setAttendanceSessionLockAction} className="quick-actions" style={{ marginTop: 0 }}>
              <input type="hidden" name="sessionId" value={roster.session.id} />
              <input type="hidden" name="locked" value={roster.session.isLocked ? "0" : "1"} />
              <button type="submit" className={roster.session.isLocked ? "quick-action-btn quick-action-primary" : "quick-action-btn quick-action-outline"}>
                {roster.session.isLocked ? "פתח נעילה" : "נעל מפגש"}
              </button>
            </form>
          ) : null}
        </div>
      </div>

      {created ? <div className="ok">המפגש נוצר ונפתח להזנת נוכחות.</div> : null}
      {synced ? <div className="ok">רשימת תלמידי המפגש סונכרנה מחדש לפי מסנני המפגש.</div> : null}
      {detailsSaved ? <div className="ok">פרטי המפגש נשמרו.</div> : null}
      {statusesSaved ? <div className="ok">סטטוסי המפגש נשמרו.</div> : null}
      {messageSaved ? <div className="ok">הודעת המפגש נשמרה.</div> : null}
      {lockSaved === "locked" ? <div className="ok">המפגש ננעל. לא ניתן לעדכן סטטוסים עד פתיחת הנעילה.</div> : null}
      {lockSaved === "unlocked" ? <div className="ok">נעילת המפגש נפתחה ואפשר לעדכן סטטוסים.</div> : null}
      {mailQueued ? <div className="ok">שליחת המיילים התחילה ברקע. אפשר לסגור את החלון והמערכת תמשיך.</div> : null}
      {mailSent ? <div className="ok">נשלחו {sentEmails || "0"} מיילים מתוך המפגש{Number(failedEmails || 0) > 0 ? `, ו-${failedEmails} נכשלו` : ""}.</div> : null}
      {mailError ? <div className="error">{mailError}</div> : null}

      <details className="card attendance-message-panel">
        <summary className="attendance-message-summary">
          <div>
            <h3>יצוא</h3>
            <span className="muted">PDF לפי המיון הנבחר. פתיחה רק כשצריך להוריד דוח.</span>
          </div>
          <span className="attendance-message-summary-action">פתח יצוא</span>
        </summary>
        <form method="get" className="grid attendance-message-grid">
          {activeStatusFilters.length ? <input type="hidden" name="statusFilter" value={activeStatusFilters.join(",")} /> : null}
          <label>
            <span className="muted">מיון PDF</span>
            <select name="exportSort" defaultValue={PDF_SORT_LABELS[exportSort] ? exportSort : "class_name"}>
              {Object.entries(PDF_SORT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <div className="quick-actions">
            <button type="submit" className="quick-action-btn quick-action-outline">החל מיון</button>
            <a
              className="quick-action-btn quick-action-primary"
              href={`/api/attendance/${roster.session.id}/pdf?sort=${encodeURIComponent(PDF_SORT_LABELS[exportSort] ? exportSort : "class_name")}`}
              target="_blank"
              rel="noreferrer"
            >
              הורד PDF
            </a>
          </div>
        </form>
      </details>

      {roster.session.isLocked ? (
        <div className="attendance-lock-banner">
          המפגש נעול לעדכוני סטטוסים. מנהל יכול לפתוח את הנעילה מהכפתור בראש הדף.
        </div>
      ) : null}

      <details className="card attendance-message-panel">
        <summary className="attendance-message-summary">
          <div>
            <h3>פרטי המפגש</h3>
            <span className="muted">{sessionSummary}</span>
          </div>
          <span className="attendance-message-summary-action">ערוך פרטים</span>
        </summary>
        <form className="grid attendance-message-grid" action={saveAttendanceSessionDetailsAction}>
          <input type="hidden" name="sessionId" value={roster.session.id} />
          <label>
            <span className="muted">סוג מפגש</span>
            <select name="sessionType" defaultValue={roster.session.sessionType || ""} required>
              {ATTENDANCE_SELECTABLE_SESSION_TYPE_ORDER.map((value) => (
                <option key={value} value={value}>{ATTENDANCE_SESSION_TYPE_LABELS[value]}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="muted">שם מפגש חופשי</span>
            <input name="title" defaultValue={roster.session.title} placeholder="למשל: ביקורת ערב" />
          </label>
          <label>
            <span className="muted">תאריך</span>
            <input name="sessionDate" type="date" defaultValue={roster.session.sessionDate} required />
          </label>
          <label style={{ gridColumn: "1 / -1" }}>
            <span className="muted">הערת מקור</span>
            <textarea name="sourceNote" rows={3} defaultValue={roster.session.sourceNote} />
          </label>
          {canManageSessionSettings ? (
            <>
              <ResponsibleUserPicker users={responsibleUsers} defaultValue={roster.session.responsibleUserId || ""} />
              <label className="attendance-visibility-toggle">
                <input
                  type="checkbox"
                  name="visibleToStudents"
                  value="1"
                  defaultChecked={roster.session.visibleToStudents}
                />
                <span className="attendance-visibility-box" aria-hidden="true" />
                <span>
                  <strong>גלוי לתלמידים</strong>
                  <small>
                    {roster.session.visibleToStudents
                      ? "מופעל עכשיו. תלמידים רלוונטיים יראו את המפגש כל עוד הוא פתוח."
                      : "כבוי עכשיו. תלמידים לא יראו את המפגש עד סימון התיבה."}
                  </small>
                </span>
              </label>
              <div style={{ gridColumn: "1 / -1", display: "grid", gap: 8 }}>
                <b>תוויות קהל יעד</b>
                <div className="attendance-filter-toolbar" style={{ marginTop: 0 }}>
                  {availableTags.length ? availableTags.map((tag) => (
                    <label key={`session-tag-${tag.id}`} className={`attendance-filter-chip${(roster.session.tagFilter || []).includes(tag.id) ? " active" : ""}`}>
                      <input
                        type="checkbox"
                        name="tagFilter"
                        value={tag.id}
                        defaultChecked={(roster.session.tagFilter || []).includes(tag.id)}
                        style={{ marginInlineEnd: 6 }}
                      />
                      {tag.name}
                    </label>
                  )) : <span className="muted">אין עדיין תוויות במערכת.</span>}
                </div>
              </div>
            </>
          ) : null}
          <div className="quick-actions">
            <button type="submit" className="quick-action-btn quick-action-outline">שמור פרטי מפגש</button>
          </div>
        </form>
      </details>

      <details className="card attendance-message-panel" open={statusesSaved}>
        <summary className="attendance-message-summary">
          <div>
            <h3>סטטוסים למפגש</h3>
            <span className="muted">פותחים רק אם צריך להוסיף סטטוסים ייחודיים.</span>
          </div>
          <span className="attendance-message-summary-action">פתח אפשרויות</span>
        </summary>
        <div>
          <p className="muted">הסטטוסים הייחודיים שייכים למפגש עצמו, ומופיעים מיד בכפתורי הנוכחות, בסינון, בדוחות וגם בשליחת המיילים.</p>
          <form className="grid" action={saveAttendanceSessionStatusesAction}>
            <input type="hidden" name="sessionId" value={roster.session.id} />
            <label style={{ gridColumn: "1 / -1" }}>
              <span className="muted">סטטוסים ייחודיים למפגש</span>
              <textarea
                name="customStatusesText"
                rows={4}
                defaultValue={serializeCustomStatuses(roster.session.customStatuses)}
                placeholder={"דוגמה:\nneeds_call|צריך שיחה\nchecked_by_office|נבדק במשרד"}
              />
            </label>
            <div className="quick-actions">
              <button type="submit" className="quick-action-btn quick-action-outline">שמור סטטוסים</button>
            </div>
          </form>
        </div>
      </details>

      <details className="card attendance-message-panel" open={messageSaved || mailQueued || mailSent || Boolean(mailError)}>
        <summary className="attendance-message-summary">
          <div>
            <h3>שליחת הודעות למפגש</h3>
            <span className="muted">פותחים רק כשצריך לשלוח מייל.</span>
          </div>
          <span className="attendance-message-summary-action">פתח אפשרויות</span>
        </summary>
        <form className="grid attendance-message-grid">
          <input type="hidden" name="sessionId" value={roster.session.id} />
          <label style={{ gridColumn: "1 / -1" }}>
            <span className="muted">נושא המייל</span>
            <input name="emailSubject" defaultValue={roster.session.emailSubject} placeholder="לדוגמה: עדכון נוכחות למפגש מנהל" />
          </label>
          <label style={{ gridColumn: "1 / -1" }}>
            <span className="muted">טקסט ההודעה</span>
            <textarea name="personalMessage" rows={4} defaultValue={roster.session.personalMessage} placeholder="לדוגמה: שלום, המערכת לא זיהתה את התלמיד במפגש. נשמח שתעדכנו את מצבו דרך הכפתורים בהודעה." />
          </label>
          <div style={{ gridColumn: "1 / -1", display: "grid", gap: 8 }}>
            <b>סטטוסים שאפשר לעדכן מתוך ההודעה</b>
            <div className="attendance-filter-toolbar" style={{ marginTop: 0 }}>
              {statusOptions.map(([value, label]) => (
                <label key={`response-${value}`} className={`attendance-filter-chip${roster.session.emailResponseStatuses.includes(value) ? " active" : ""}`}>
                  <input
                    type="checkbox"
                    name="emailResponseStatuses"
                    value={value}
                    defaultChecked={roster.session.emailResponseStatuses.includes(value)}
                    style={{ marginInlineEnd: 6 }}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div style={{ gridColumn: "1 / -1", display: "grid", gap: 8 }}>
            <b>למי שולחים</b>
            <div className="attendance-filter-toolbar" style={{ marginTop: 0 }}>
              {Object.entries(ATTENDANCE_EMAIL_RECIPIENT_LABELS).map(([value, label]) => (
                <label key={`recipient-${value}`} className={`attendance-filter-chip${roster.session.emailRecipientRoles.includes(value) ? " active" : ""}`}>
                  <input
                    type="checkbox"
                    name="emailRecipientRoles"
                    value={value}
                    defaultChecked={roster.session.emailRecipientRoles.includes(value)}
                    style={{ marginInlineEnd: 6 }}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div style={{ gridColumn: "1 / -1", display: "grid", gap: 8 }}>
            <b>שלח לסטטוסים</b>
            <div className="attendance-filter-toolbar" style={{ marginTop: 0 }}>
              {statusOptions.map(([value, label]) => (
                <label key={`target-${value}`} className="attendance-filter-chip">
                  <input
                    type="checkbox"
                    name="targetStatuses"
                    value={value}
                    defaultChecked={value === "missing"}
                    style={{ marginInlineEnd: 6 }}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div className="quick-actions">
            <button formAction={saveAttendanceSessionMessagingAction} className="quick-action-btn quick-action-outline">שמור הודעה</button>
            <AttendanceEmailSendSubmit formAction={sendAttendanceSessionEmailsAction} />
          </div>
        </form>
      </details>

      <AttendanceRosterClient
        sessionId={roster.session.id}
        students={roster.students}
        statusOptions={statusOptions}
        activeStatusFilters={activeStatusFilters}
        initialStats={roster.stats}
        isLocked={roster.session.isLocked}
      />
    </>
  );
}
