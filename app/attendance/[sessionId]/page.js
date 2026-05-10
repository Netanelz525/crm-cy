import Link from "next/link";
import { redirect } from "next/navigation";
import AttendanceRosterClient from "../attendance-roster-client";
import {
  ATTENDANCE_STATUS_LABELS,
  getAttendanceRoster
} from "../../../lib/attendance";
import { getCurrentAppUser } from "../../../lib/rbac";

function clean(value) {
  return String(value || "").trim();
}

function attendanceStatusOptions() {
  return Object.entries(ATTENDANCE_STATUS_LABELS);
}

export default async function AttendanceSessionPage({ params, searchParams }) {
  const currentUser = await getCurrentAppUser();
  if (!currentUser) redirect("/sign-in");
  if (!currentUser.is_team_member && !currentUser.is_manager) redirect("/unauthorized");

  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const sessionId = clean(resolvedParams?.sessionId);
  const created = clean(resolvedSearchParams?.created) === "1";
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
        <p className="muted">
          זהו עמוד המפגש עצמו. כאן רואים רק את פרטי המפגש ואת הזנת הנוכחות שלו.
        </p>
        <div className="quick-actions">
          <Link className="quick-action-btn quick-action-outline" href="/attendance">חזרה למפגשים</Link>
          <a
            className="quick-action-btn quick-action-primary"
            href={`/api/attendance/${roster.session.id}/pdf`}
            target="_blank"
            rel="noreferrer"
          >
            הורד PDF
          </a>
        </div>
      </div>

      {created ? <div className="ok">המפגש נוצר ונפתח להזנת נוכחות.</div> : null}

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
        </div>
        <div className="attendance-stats">
          <span className="meta-chip">תלמידים: {roster.stats.totalStudents}</span>
          <span className="meta-chip">נמצאו: {roster.stats.found}</span>
          <span className="meta-chip">איחרו: {roster.stats.late}</span>
          <span className="meta-chip">לא נמצאו: {roster.stats.missing}</span>
          <span className="meta-chip">נשלחו לבית: {roster.stats.sent_home}</span>
        </div>
      </div>

      <div className="card summary-row">
        <div className="muted">ייצוא PDF זמין ומסודר כמו באתר: לפי שיעור ואז לפי שם משפחה.</div>
      </div>

      <AttendanceRosterClient
        sessionId={roster.session.id}
        students={roster.students}
        statusOptions={attendanceStatusOptions()}
      />
    </>
  );
}
