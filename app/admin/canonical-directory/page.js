import Link from "next/link";
import { getCanonicalDirectoryDashboard } from "../../../lib/canonical-directory";
import { requireSuperAdmin } from "../../../lib/rbac";
import { syncCanonicalDirectoryAction } from "../actions";

function formatConfidence(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `${Math.round(Number(value) * 100)}%`;
}

function relationLabel(value) {
  if (value === "father_of") return "אב";
  if (value === "mother_of") return "אם";
  return value || "-";
}

function severityLabel(value) {
  if (value === "high") return "גבוה";
  if (value === "warn") return "בינוני";
  return "מידע";
}

export default async function CanonicalDirectoryPage() {
  await requireSuperAdmin();
  const dashboard = await getCanonicalDirectoryDashboard({ autoSync: true });

  return (
    <>
      <div className="card glass">
        <h1>ספר אנשים ומוסדות</h1>
        <p className="muted">
          שכבת הנתונים החדשה רצה במקביל למסך הקיים. כאן אפשר לראות אנשים, קשרי הורים-תלמידים,
          שיוכים למוסדות, והתראות על התאמות או כפילויות לפני שמעבירים את העבודה השוטפת למודל החדש.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
          <form action={syncCanonicalDirectoryAction}>
            <button type="submit">סנכרן מחדש מהנתונים הקיימים</button>
          </form>
          <Link href="/admin">חזרה לניהול</Link>
        </div>
      </div>

      <div className="card">
        <h2>סטטיסטיקה</h2>
        <div className="student-meta-line" style={{ flexWrap: "wrap", gap: 10 }}>
          <span className="meta-chip">אנשים: {dashboard.stats.peopleCount}</span>
          <span className="meta-chip">פרופילי תלמיד: {dashboard.stats.studentProfilesCount}</span>
          <span className="meta-chip">תפקידי הורה: {dashboard.stats.parentRoleCount}</span>
          <span className="meta-chip">קשרים: {dashboard.stats.relationshipCount}</span>
          <span className="meta-chip">מוסדות: {dashboard.stats.institutionsCount}</span>
          <span className="meta-chip meta-chip-strong">התראות פתוחות: {dashboard.stats.openAlertCount}</span>
        </div>
      </div>

      <div className="card">
        <h2>מוסדות</h2>
        <div className="desktop-table">
          <table>
            <thead>
              <tr>
                <th>קוד</th>
                <th>שם</th>
                <th>סוג</th>
                <th>תלמידים משויכים</th>
              </tr>
            </thead>
            <tbody>
              {!dashboard.institutions.length ? (
                <tr>
                  <td colSpan={4} className="muted">עדיין אין נתוני מוסדות.</td>
                </tr>
              ) : (
                dashboard.institutions.map((institution) => (
                  <tr key={institution.id}>
                    <td><code>{institution.code}</code></td>
                    <td>{institution.name}</td>
                    <td>{institution.institution_type}</td>
                    <td>{institution.student_count}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>התראות והמלצות התאמה</h2>
        <div className="desktop-table">
          <table>
            <thead>
              <tr>
                <th>חומרה</th>
                <th>כותרת</th>
                <th>ישות</th>
                <th>סוג</th>
                <th>ודאות</th>
              </tr>
            </thead>
            <tbody>
              {!dashboard.alerts.length ? (
                <tr>
                  <td colSpan={5} className="muted">אין כרגע התראות פתוחות.</td>
                </tr>
              ) : (
                dashboard.alerts.map((alert) => (
                  <tr key={alert.id}>
                    <td>{severityLabel(alert.severity)}</td>
                    <td>{alert.title}</td>
                    <td><code>{alert.entity_type}:{alert.entity_id}</code></td>
                    <td>{alert.alert_type}</td>
                    <td>{formatConfidence(alert.confidence_score)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>משפחות ותלמידים</h2>
        <div className="desktop-table">
          <table>
            <thead>
              <tr>
                <th>תלמיד</th>
                <th>מוסד</th>
                <th>שיעור</th>
                <th>הורים מקושרים</th>
                <th>סטטוס התאמה</th>
                <th>התראות</th>
              </tr>
            </thead>
            <tbody>
              {!dashboard.families.length ? (
                <tr>
                  <td colSpan={6} className="muted">עדיין אין משפחות מסונכרנות.</td>
                </tr>
              ) : (
                dashboard.families.map((family) => (
                  <tr key={family.studentId}>
                    <td>{family.studentName}</td>
                    <td>{family.currentInstitutionCode || "-"}</td>
                    <td>{family.classCode || "-"}</td>
                    <td>
                      {family.parents.length ? family.parents.map((parent) => (
                        <div key={`${family.studentId}-${parent.relationType}-${parent.canonicalName}`}>
                          {relationLabel(parent.relationType)}: {parent.canonicalName || "ללא שם"} ({formatConfidence(parent.confidenceScore)})
                        </div>
                      )) : "-"}
                    </td>
                    <td>{family.matchStatus}</td>
                    <td>{family.alertCount}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
