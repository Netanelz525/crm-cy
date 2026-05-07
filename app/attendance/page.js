import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ATTENDANCE_STATUS_LABELS,
  getAttendanceRoster,
  listAttendanceSessions
} from "../../lib/attendance";
import { getCurrentAppUser } from "../../lib/rbac";
import { INSTITUTIONS } from "../../lib/student-view";
import { createAttendanceSessionAction, saveAttendanceRecordsAction } from "./actions";

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

export default async function AttendancePage({ searchParams }) {
  const currentUser = await getCurrentAppUser();
  if (!currentUser) redirect("/sign-in");
  if (!currentUser.is_team_member && !currentUser.is_manager) redirect("/unauthorized");

  const resolvedSearchParams = await searchParams;
  const sessionId = clean(resolvedSearchParams?.sessionId);
  const created = clean(resolvedSearchParams?.created) === "1";
  const saved = clean(resolvedSearchParams?.saved) === "1";
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
      {saved ? <div className="ok">הנוכחות נשמרה בהצלחה.</div> : null}

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

          <div className="card">
            <h3>הזנת נוכחות</h3>
            <p className="muted">
              ברירת המחדל היא נוכח. אפשר לעבור שורה-שורה ולעדכן סטטוס והערה לפי התיעוד.
            </p>
            <form action={saveAttendanceRecordsAction}>
              <input type="hidden" name="sessionId" value={roster.session.id} />
              <div className="attendance-table-wrap">
                <table className="attendance-table">
                  <thead>
                    <tr>
                      <th>שם</th>
                      <th>שיעור</th>
                      <th>סטטוס</th>
                      <th>הערה</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roster.students.map((student) => (
                      <tr key={student.id}>
                        <td>
                          <input type="hidden" name="studentId" value={student.id} />
                          <input type="hidden" name={`studentName:${student.id}`} value={student.label} />
                          <input type="hidden" name={`studentClass:${student.id}`} value={student.class} />
                          <div className="attendance-student-name">{student.label}</div>
                        </td>
                        <td>{student.classLabel}</td>
                        <td>
                          <select name={`status:${student.id}`} defaultValue={student.status}>
                            {Object.entries(ATTENDANCE_STATUS_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            name={`note:${student.id}`}
                            defaultValue={student.noteText}
                            placeholder="הערה קצרה"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="quick-actions">
                <button type="submit" className="btn btn-save">שמור נוכחות</button>
              </div>
            </form>
          </div>
        </>
      ) : sessionId ? (
        <div className="card">לא נמצא מפגש נוכחות תואם.</div>
      ) : (
        <div className="card muted">בחר מפגש קיים או צור מפגש חדש כדי להתחיל להזין נוכחות.</div>
      )}
    </>
  );
}
