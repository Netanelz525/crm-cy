import Link from "next/link";

function clean(value) {
  return String(value || "").trim();
}

function formatDate(value) {
  const raw = clean(value);
  if (!raw) return "-";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString("he-IL");
}

export default function OpenAttendanceSessionsPanel({ studentId, sessions = [], action }) {
  if (!sessions.length) {
    return (
      <div className="linked-record-card placeholder">
        <b>מפגשים פתוחים</b>
        <div className="linked-record-meta">אין כרגע מפגשים פתוחים לעדכון בכרטיס הזה.</div>
      </div>
    );
  }

  return (
    <div className="open-attendance-panel">
      <div className="open-attendance-panel-head">
        <b>מפגשים פתוחים לעדכון</b>
        <span className="linked-record-pill">{sessions.length}</span>
      </div>
      <div className="open-attendance-list">
        {sessions.map(({ session, student }) => (
          <form key={session.id} action={action} className="linked-record-card open-attendance-card">
            <input type="hidden" name="studentId" value={studentId} />
            <input type="hidden" name="sessionId" value={session.id} />
            <div className="linked-record-card-top">
              <div>
                <b>{session.displayTitle || session.title || session.sessionTypeLabel || "מפגש נוכחות"}</b>
                <div className="linked-record-meta">
                  {session.institutionLabel} | {formatDate(session.sessionDate)}
                  {session.sessionWeekdayLabel ? ` | ${session.sessionWeekdayLabel}` : ""}
                </div>
              </div>
              <Link className="linked-record-title" href={`/attendance/${encodeURIComponent(session.id)}`}>
                פתח מפגש
              </Link>
            </div>
            <div className="open-attendance-fields">
              <label>
                <span className="muted">סטטוס</span>
                <select name="status" defaultValue={student.status}>
                  {(session.statusOptions || []).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="muted">הערה</span>
                <input name="noteText" defaultValue={student.noteText || ""} placeholder="הערה קצרה" />
              </label>
              <button type="submit" className="quick-action-btn quick-action-primary">עדכן</button>
            </div>
          </form>
        ))}
      </div>
    </div>
  );
}
