import { formatAutomationRunSummary, listSystemAutomationsOverview } from "../../lib/system-automations";

function formatDateTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("he-IL");
}

function statusLabel(status) {
  const normalized = String(status || "").trim().toLowerCase();
  switch (normalized) {
    case "completed":
      return "הושלם";
    case "failed":
      return "נכשל";
    case "started":
      return "בתהליך";
    default:
      return normalized || "-";
  }
}

function statusClass(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "completed") return "meta-chip automation-chip-ok";
  if (normalized === "failed") return "meta-chip automation-chip-error";
  return "meta-chip";
}

export default async function SystemAutomationsCard() {
  const automations = await listSystemAutomationsOverview();

  return (
    <div className="card">
      <div className="summary-row" style={{ alignItems: "flex-end", gap: 16 }}>
        <div>
          <h2 style={{ marginBottom: 6 }}>תהליכים אוטומטיים במערכת</h2>
          <p className="muted" style={{ margin: 0 }}>
            אזור סופר אדמין בלבד עם ריכוז ה-cron jobs, היעד שלהם, והיסטוריית ריצות אחרונה.
          </p>
        </div>
        <div className="student-meta-line">
          <span className="meta-chip meta-chip-strong">סופר אדמין בלבד</span>
        </div>
      </div>

      <div style={{ display: "grid", gap: 16, marginTop: 18 }}>
        {automations.map((automation) => (
          <div
            key={automation.jobName}
            style={{
              display: "grid",
              gap: 12,
              padding: 16,
              border: "1px solid #d7e1ef",
              borderRadius: 18,
              background: "linear-gradient(180deg, #ffffff, #f8fbff)"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
              <div>
                <strong>{automation.title}</strong>
                <div className="muted" style={{ marginTop: 4 }}>{automation.description}</div>
              </div>
              <div className="student-meta-line">
                <span className="meta-chip">{automation.kind.toUpperCase()}</span>
                <span className={statusClass(automation?.latestRun?.status)}>
                  {automation.latestRun ? statusLabel(automation.latestRun.status) : "עדיין לא רץ"}
                </span>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "8px 12px", color: "#5a6f89" }}>
              <div><b>נתיב:</b> <code>{automation.path}</code></div>
              <div><b>תדירות:</b> {automation.schedule}</div>
              <div><b>יעד:</b> {automation.target}</div>
              <div><b>ריצה אחרונה:</b> {formatDateTime(automation?.latestRun?.startedAt)}</div>
              <div><b>הסתיים:</b> {formatDateTime(automation?.latestRun?.completedAt)}</div>
              <div><b>סיכום אחרון:</b> {automation.latestRun ? formatAutomationRunSummary(automation.latestRun) : "אין עדיין ריצות שמורות."}</div>
            </div>

            <details className="linked-record-group" style={{ marginTop: 4 }}>
              <summary className="linked-record-group-summary" style={{ padding: 0, border: "none", background: "transparent" }}>
                <div>
                  <b>היסטוריית ריצות</b>
                  <div className="linked-record-meta">8 הריצות האחרונות של התהליך.</div>
                </div>
              </summary>
              <div className="linked-record-group-body" style={{ padding: 0 }}>
                <div className="desktop-table">
                  <table>
                    <thead>
                      <tr>
                        <th>מפתח ריצה</th>
                        <th>סטטוס</th>
                        <th>התחלה</th>
                        <th>סיום</th>
                        <th>סיכום</th>
                      </tr>
                    </thead>
                    <tbody>
                      {!automation.history.length ? (
                        <tr>
                          <td colSpan={5} className="muted">עדיין אין היסטוריית ריצות.</td>
                        </tr>
                      ) : (
                        automation.history.map((run) => (
                          <tr key={`${run.jobName}-${run.jobKey}-${run.startedAt || "na"}`}>
                            <td>{run.jobKey || "-"}</td>
                            <td>{statusLabel(run.status)}</td>
                            <td>{formatDateTime(run.startedAt)}</td>
                            <td>{formatDateTime(run.completedAt)}</td>
                            <td>{formatAutomationRunSummary(run)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="mobile-generic-list">
                  {!automation.history.length ? (
                    <div className="generic-mobile-card muted">עדיין אין היסטוריית ריצות.</div>
                  ) : (
                    automation.history.map((run) => (
                      <div key={`${run.jobName}-${run.jobKey}-${run.startedAt || "na"}-mobile`} className="generic-mobile-card">
                        <div className="generic-mobile-head">{run.jobKey || "ריצה ללא מפתח"}</div>
                        <div className="generic-mobile-grid">
                          <div><b>סטטוס:</b> {statusLabel(run.status)}</div>
                          <div><b>התחלה:</b> {formatDateTime(run.startedAt)}</div>
                          <div><b>סיום:</b> {formatDateTime(run.completedAt)}</div>
                          <div><b>סיכום:</b> {formatAutomationRunSummary(run)}</div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </details>
          </div>
        ))}
      </div>
    </div>
  );
}
