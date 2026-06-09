import Link from "next/link";
import { redirect } from "next/navigation";
import AttendanceRosterClient from "../attendance-roster-client";
import {
  saveAttendanceSessionMessagingAction,
  sendAttendanceSessionEmailsAction,
  syncAttendanceSessionStudentsAction
} from "../actions";
import {
  ATTENDANCE_EMAIL_RECIPIENT_LABELS,
  ATTENDANCE_STATUS_LABELS,
  getAttendanceRoster
} from "../../../lib/attendance";
import { ATTENDANCE_EXPORT_SORT_LABELS as PDF_SORT_LABELS } from "../../../lib/attendance-exports";
import { getCurrentAppUser } from "../../../lib/rbac";

function clean(value) {
  return String(value || "").trim();
}

function attendanceStatusOptions() {
  return Object.entries(ATTENDANCE_STATUS_LABELS);
}

function formatSessionAudience(session) {
  const institutionLabels = (session?.institutionFilterOptions || []).map((item) => item.label);
  const classLabels = (session?.classFilterOptions || []).map((item) => item.label);
  const registrationLabels = (session?.registrationFilterOptions || []).map((item) => item.label);
  const familyStatusLabels = (session?.familyStatusFilterOptions || []).map((item) => item.label);
  const parts = [];
  if (institutionLabels.length) parts.push(`מוסדות: ${institutionLabels.join(", ")}`);
  if (classLabels.length) parts.push(`שיעורים: ${classLabels.join(", ")}`);
  if (registrationLabels.length) parts.push(`רישום: ${registrationLabels.join(", ")}`);
  if (familyStatusLabels.length) parts.push(`סטטוס משפחתי: ${familyStatusLabels.join(", ")}`);
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
  const messageSaved = clean(resolvedSearchParams?.messageSaved) === "1";
  const mailSent = clean(resolvedSearchParams?.mailSent) === "1";
  const sentEmails = clean(resolvedSearchParams?.sentEmails);
  const activeStatusFilters = clean(resolvedSearchParams?.statusFilter)
    .split(",")
    .map((value) => clean(value).toLowerCase())
    .filter(Boolean);
  const exportSort = clean(resolvedSearchParams?.exportSort).toLowerCase() || "class_name";
  const roster = sessionId ? await getAttendanceRoster(sessionId) : null;

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
          <form method="get" className="quick-actions" style={{ marginTop: 0 }}>
            {activeStatusFilters.length ? <input type="hidden" name="statusFilter" value={activeStatusFilters.join(",")} /> : null}
            <select name="exportSort" defaultValue={PDF_SORT_LABELS[exportSort] ? exportSort : "class_name"} style={{ minWidth: 220 }}>
              {Object.entries(PDF_SORT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <button type="submit" className="quick-action-btn quick-action-outline">החל מיון</button>
            <a
              className="quick-action-btn quick-action-primary"
              href={`/api/attendance/${roster.session.id}/pdf?sort=${encodeURIComponent(PDF_SORT_LABELS[exportSort] ? exportSort : "class_name")}`}
              target="_blank"
              rel="noreferrer"
            >
              הורד PDF
            </a>
          </form>
        </div>
      </div>

      {created ? <div className="ok">המפגש נוצר ונפתח להזנת נוכחות.</div> : null}
      {synced ? <div className="ok">רשימת תלמידי המפגש סונכרנה מחדש לפי מסנני המפגש.</div> : null}
      {messageSaved ? <div className="ok">הודעת המפגש נשמרה.</div> : null}
      {mailSent ? <div className="ok">נשלחו {sentEmails || "0"} מיילים מתוך המפגש.</div> : null}

      <div className="card summary-row">
        <div>
          <b>{roster.session.institutionLabel}</b>
          {" | "}
          {roster.session.sessionTypeLabel || roster.session.title || "ללא סוג"}
          {" | "}
          {roster.session.sessionDate}
          {roster.session.sessionWeekdayLabel ? ` | ${roster.session.sessionWeekdayLabel}` : ""}
          {roster.session.sessionHebrewDateLabel ? ` | ${roster.session.sessionHebrewDateLabel}` : ""}
          {roster.session.createdByDisplayName ? ` | נוצר על ידי: ${roster.session.createdByDisplayName}` : ""}
          {formatSessionAudience(roster.session) ? ` | ${formatSessionAudience(roster.session)}` : ""}
        </div>
        <div className="attendance-stats">
          <span className="meta-chip">תלמידים: {roster.stats.totalStudents}</span>
          <span className="meta-chip">נמצאו: {roster.stats.found}</span>
          <span className="meta-chip">זמינים: {roster.stats.available}</span>
          <span className="meta-chip">לא נמצאו: {roster.stats.missing}</span>
          <span className="meta-chip">בדרך: {roster.stats.on_the_way}</span>
        </div>
      </div>

      <div className="card">
        <h3>הודעה אישית למפגש</h3>
        <p className="muted">אפשר לשמור טקסט אישי למפגש ולשלוח מיילים רק לסטטוסים שתבחר, עם כפתורי עדכון חזרה למערכת.</p>
        <form className="grid">
          <input type="hidden" name="sessionId" value={roster.session.id} />
          <label style={{ gridColumn: "1 / -1" }}>
            <span className="muted">טקסט ההודעה</span>
            <textarea name="personalMessage" rows={5} defaultValue={roster.session.personalMessage} placeholder="לדוגמה: שלום, המערכת לא זיהתה את התלמיד במפגש. נשמח שתעדכנו את מצבו דרך הכפתורים במייל." />
          </label>
          <div style={{ gridColumn: "1 / -1", display: "grid", gap: 8 }}>
            <b>סטטוסים שאפשר לעדכן מתוך המייל</b>
            <div className="attendance-filter-toolbar" style={{ marginTop: 0 }}>
              {attendanceStatusOptions().map(([value, label]) => (
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
            <b>למי שולחים את המייל</b>
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
            <b>שלח מיילים לסטטוסים</b>
            <div className="attendance-filter-toolbar" style={{ marginTop: 0 }}>
              {attendanceStatusOptions().map(([value, label]) => (
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
            <button formAction={sendAttendanceSessionEmailsAction} className="quick-action-btn quick-action-primary">שלח מיילים למפגש</button>
          </div>
        </form>
      </div>

      <AttendanceRosterClient
        sessionId={roster.session.id}
        students={roster.students}
        statusOptions={attendanceStatusOptions()}
        activeStatusFilters={activeStatusFilters}
      />
    </>
  );
}
