import Link from "next/link";
import { redirect } from "next/navigation";
import AttendanceRosterClient from "./attendance-roster-client";
import {
  ATTENDANCE_STATUS_LABELS,
  getAttendanceRoster,
  listAttendanceSessions
} from "../../lib/attendance";
import { getCurrentAppUser } from "../../lib/rbac";
import { INSTITUTIONS } from "../../lib/student-view";
import { createAttendanceSessionAction } from "./actions";

function clean(value) {
  return String(value || "").trim();
}

function formatSessionLabel(session) {
  const title = clean(session?.title);
  const institutionLabel = clean(session?.institutionLabel);
  const sessionDate = clean(session?.sessionDate);
  return [institutionLabel, title, sessionDate].filter(Boolean).join(" | ");
}

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function attendanceStatusOptions() {
  return Object.entries(ATTENDANCE_STATUS_LABELS);
}

export default async function AttendancePage({ searchParams }) {
  const currentUser = await getCurrentAppUser();
  if (!currentUser) redirect("/sign-in");
  if (!currentUser.is_team_member && !currentUser.is_manager) redirect("/unauthorized");

  const resolvedSearchParams = await searchParams;
  const sessionId = clean(resolvedSearchParams?.sessionId);
  const created = clean(resolvedSearchParams?.created) === "1";
  const sessions = await listAttendanceSessions({ limit: 18 });
  const roster = sessionId ? await getAttendanceRoster(sessionId) : null;

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

      {created ? <div className="ok">המפגש נוצר ונפתח להזנת נוכחות.</div> : null}
      <div className="attendance-layout">
        <section className="card glass">
          <h3>יצירת מפגש חדש</h3>
          <form action={createAttendanceSessionAction} className="grid">
            <select name="institution" defaultValue="" required>
              <option value="">בחר מוסד</option>
              {Object.entries(INSTITUTIONS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <input name="title" placeholder="כותרת מפגש, למשל סדר בוקר" />
            <input name="sessionDate" type="date" defaultValue={todayInputValue()} required />
            <textarea name="sourceNote" placeholder="הערת מקור או תיעוד חופשי מהדף" />
            <button type="submit">צור מפגש והתחל להזין</button>
          </form>
        </section>

        <aside className="card glass">
          <h3>מפגשים אחרונים</h3>
          {!sessions.length ? (
            <p className="muted">עדיין לא נוצרו מפגשי נוכחות.</p>
          ) : (
            <div className="attendance-session-list">
              {sessions.map((session) => (
                <Link
                  key={session.id}
                  className={`attendance-session-link${session.id === sessionId ? " active" : ""}`}
                  href={`/attendance?sessionId=${session.id}`}
                >
                  <strong>{formatSessionLabel(session)}</strong>
                  {session.sourceNote ? <span>{session.sourceNote}</span> : <span>{session.id}</span>}
                </Link>
              ))}
            </div>
          )}
        </aside>
      </div>

      {roster ? (
        <>
          <div className="card summary-row">
            <div>
              <b>{roster.session.institutionLabel}</b>
              {" | "}
              {roster.session.title || "ללא כותרת"}
              {" | "}
              {roster.session.sessionDate}
            </div>
            <div className="attendance-stats">
              <span className="meta-chip">תלמידים: {roster.stats.totalStudents}</span>
              <span className="meta-chip">נוכחים: {roster.stats.present}</span>
              <span className="meta-chip">איחרו: {roster.stats.late}</span>
              <span className="meta-chip">נעדרו: {roster.stats.absent}</span>
              <span className="meta-chip">מוצדקים: {roster.stats.excused}</span>
            </div>
          </div>
          <div className="card summary-row">
            <div className="muted">ייצוא PDF זמין וממויין לפי סטטוס נוכחות ולאחר מכן לפי שיעור.</div>
            <div className="quick-actions" style={{ marginTop: 0 }}>
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
          <AttendanceRosterClient
            sessionId={roster.session.id}
            students={roster.students}
            statusOptions={attendanceStatusOptions()}
            initialStats={roster.stats}
          />
        </>
      ) : sessionId ? (
        <div className="card">לא נמצא מפגש נוכחות תואם.</div>
      ) : (
        <div className="card muted">בחר מפגש קיים או צור מפגש חדש כדי להתחיל להזין נוכחות.</div>
      )}
    </>
  );
}
