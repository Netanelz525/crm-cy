function clean(value) {
  return String(value || "").trim();
}

function formatPercent(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return "0%";
  return `${numeric % 1 === 0 ? numeric.toFixed(0) : numeric.toFixed(1)}%`;
}

function formatDate(value) {
  const raw = clean(value);
  if (!raw) return "-";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString("he-IL");
}

export default function AttendanceHistoryPanel({ summary, history }) {
  const totalSessions = Number(summary?.totalSessions || 0);

  return (
    <div className="card attendance-history-panel">
      <div className="attendance-history-head">
        <div>
          <h3>היסטוריית נוכחות</h3>
          <p className="muted" style={{ marginBottom: 0 }}>
            הנתונים מחושבים מתוך מפגשי הנוכחות שנשמרו במערכת.
          </p>
        </div>
        <div className="attendance-percent-badge">{formatPercent(summary?.attendancePercent)}</div>
      </div>

      <div className="attendance-summary-grid">
        <div className="attendance-summary-card">
          <strong>{totalSessions}</strong>
          <span>מפגשים מדווחים</span>
        </div>
        <div className="attendance-summary-card">
          <strong>{summary?.attendedSessions || 0}</strong>
          <span>נוכחות בפועל</span>
        </div>
        <div className="attendance-summary-card">
          <strong>{summary?.missing || 0}</strong>
          <span>לא נמצא</span>
        </div>
        <div className="attendance-summary-card">
          <strong>{summary?.sentHome || 0}</strong>
          <span>נשלח לבית</span>
        </div>
      </div>

      <div className="student-meta-line" style={{ marginTop: 12 }}>
        <span className="meta-chip">נמצא: {summary?.found || 0}</span>
        <span className="meta-chip">איחר: {summary?.late || 0}</span>
        <span className="meta-chip">נשלח לבית: {summary?.sentHome || 0}</span>
      </div>

      {!history?.length ? (
        <div className="linked-record-card placeholder" style={{ marginTop: 14 }}>
          <b>אין עדיין היסטוריית נוכחות</b>
          <div className="linked-record-meta">ברגע שיישמרו מפגשים עם נתוני נוכחות, הם יוצגו כאן.</div>
        </div>
      ) : (
        <div className="attendance-history-list">
          {history.map((entry) => (
            <div key={`${entry.sessionId}-${entry.studentId}`} className="linked-record-card">
              <div className="linked-record-card-top">
                <b>{entry.sessionTitle || "מפגש נוכחות"}</b>
                <span className="linked-record-pill">{entry.statusLabel}</span>
              </div>
              <div className="linked-record-meta">מוסד: {entry.institutionLabel}</div>
              <div className="linked-record-meta">תאריך: {formatDate(entry.sessionDate)}</div>
              <div className="linked-record-meta">שיעור: {entry.studentClassLabel || "-"}</div>
              <div className="linked-record-meta">הערה: {entry.noteText || "-"}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
