import Link from "next/link";

function clean(value) {
  return String(value || "").trim();
}

export default async function AttendanceEmailResponsePage({ searchParams }) {
  const resolvedSearchParams = await searchParams;
  const done = clean(resolvedSearchParams?.done) === "1";
  const error = clean(resolvedSearchParams?.error);
  const student = clean(resolvedSearchParams?.student);
  const status = clean(resolvedSearchParams?.status);
  const session = clean(resolvedSearchParams?.session);

  return (
    <div className="card glass">
      <h1>עדכון נוכחות מהמייל</h1>
      {done ? (
        <>
          <p className="muted">העדכון נשמר בהצלחה במערכת.</p>
          <div className="student-meta-line">
            {student ? <span className="meta-chip">תלמיד: {student}</span> : null}
            {status ? <span className="meta-chip">סטטוס: {status}</span> : null}
            {session ? <span className="meta-chip">מפגש: {session}</span> : null}
          </div>
        </>
      ) : (
        <p className="muted">{error || "לא הצלחנו לעדכן את הנוכחות דרך הקישור הזה."}</p>
      )}
      <div className="quick-actions">
        <Link className="quick-action-btn quick-action-outline" href="/">חזרה לאתר</Link>
      </div>
    </div>
  );
}
