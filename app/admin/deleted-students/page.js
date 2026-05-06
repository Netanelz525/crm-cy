import Link from "next/link";
import { redirect } from "next/navigation";
import { listSoftDeletedStudents, purgeExpiredSoftDeletedStudents } from "../../../lib/deleted-students";
import { getCurrentAppUser } from "../../../lib/rbac";
import { purgeDeletedStudentNowAction, restoreDeletedStudentAction } from "./actions";

function clean(value) {
  return String(value || "").trim();
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return clean(value);
  return date.toLocaleString("he-IL");
}

export default async function DeletedStudentsPage({ searchParams }) {
  const currentUser = await getCurrentAppUser();
  if (!currentUser) redirect("/sign-in");
  if (!currentUser.is_team_member && !currentUser.is_manager) redirect("/unauthorized");

  await purgeExpiredSoftDeletedStudents();
  const resolvedSearchParams = await searchParams;
  const rows = await listSoftDeletedStudents();
  const deleted = clean(resolvedSearchParams?.deleted) === "1";
  const restored = clean(resolvedSearchParams?.restored) === "1";
  const purged = clean(resolvedSearchParams?.purged) === "1";
  const error = clean(resolvedSearchParams?.error);

  return (
    <>
      <div className="card glass">
        <h1>תלמידים שנמחקו זמנית</h1>
        <p className="muted">כאן נשמרים תלמידים שנמחקו ל-30 יום לפני מחיקה סופית. בתקופה הזו הם מוסתרים מכל הרשימות.</p>
        <div className="quick-actions">
          <Link className="quick-action-btn quick-action-outline" href="/">חזרה לרשימה הראשית</Link>
          <Link className="quick-action-btn quick-action-outline" href="/neon">חזרה ל-Neon</Link>
        </div>
      </div>

      {deleted ? <div className="ok">התלמיד הועבר לאזור המחיקה הזמני.</div> : null}
      {restored ? <div className="ok">התלמיד שוחזר בהצלחה.</div> : null}
      {purged ? <div className="ok">התלמיד נמחק סופית מהמערכת.</div> : null}
      {error ? <div className="card muted">{error}</div> : null}

      <div className="card">
        <h3>ממתינים למחיקה סופית: {rows.length}</h3>
        {!rows.length ? (
          <div className="muted">אין כרגע תלמידים באזור המחיקה הזמני.</div>
        ) : (
          <div className="linked-records-grid">
            {rows.map((row) => (
              <div key={row.student_id} className="linked-record-card">
                <b>{clean(row.student_name) || "תלמיד"}</b>
                <div className="linked-record-meta">מזהה: {clean(row.student_id) || "-"}</div>
                <div className="linked-record-meta">נמחק ב: {formatDateTime(row.deleted_at)}</div>
                <div className="linked-record-meta">מחיקה סופית ב: {formatDateTime(row.delete_after_at)}</div>
                <div className="quick-actions" style={{ marginTop: 12 }}>
                  <form action={restoreDeletedStudentAction}>
                    <input type="hidden" name="studentId" value={row.student_id} />
                    <button type="submit" className="btn btn-ghost">שחזר</button>
                  </form>
                  <form action={purgeDeletedStudentNowAction}>
                    <input type="hidden" name="studentId" value={row.student_id} />
                    <button type="submit" className="btn btn-danger">מחק סופית עכשיו</button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
