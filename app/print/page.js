import Link from "next/link";
import { redirect } from "next/navigation";
import { canUsePrintQueue, listPrintJobs, MAX_PRINT_FILE_BYTES } from "../../lib/print-jobs";
import { requireAuthenticatedUser } from "../../lib/rbac";
import { createPrintJobAction } from "./actions";

function clean(value) {
  return String(value || "").trim();
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" });
}

function formatSize(bytes) {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) return "-";
  if (size < 1024 * 1024) return `${Math.round(size / 102.4) / 10}KB`;
  return `${Math.round((size / 1024 / 1024) * 10) / 10}MB`;
}

function statusLabel(status) {
  switch (clean(status)) {
    case "claimed":
      return "נאסף על ידי שרת מקומי";
    case "pending":
    default:
      return "ממתין לאיסוף";
  }
}

export default async function PrintPage({ searchParams }) {
  const user = await requireAuthenticatedUser();
  if (!canUsePrintQueue(user)) redirect("/unauthorized");
  const resolvedSearchParams = await searchParams;
  const uploaded = clean(resolvedSearchParams?.uploaded) === "1";
  const error = clean(resolvedSearchParams?.error);
  const jobs = await listPrintJobs({ limit: 50 });

  return (
    <>
      <div className="card glass">
        <h1>שליחה להדפסה</h1>
        <p className="muted">
          מעלים מסמך עד {formatSize(MAX_PRINT_FILE_BYTES)}. המסמך נשמר זמנית ב-Neon עד שהשרת המקומי אוסף אותו ומוחק אותו מהתור.
        </p>
        <div className="quick-actions">
          <Link className="quick-action-btn quick-action-outline" href="/neon">חזרה לתלמידים</Link>
          <Link className="quick-action-btn quick-action-outline" href="/admin/api-access">טוקנים לשרת מקומי</Link>
        </div>
      </div>

      {uploaded ? <div className="ok">המסמך נשלח לתור ההדפסה.</div> : null}
      {error ? <div className="error">{error}</div> : null}

      <section className="card">
        <h3>מסמך חדש להדפסה</h3>
        <form action={createPrintJobAction} className="grid">
          <input
            type="file"
            name="file"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.txt"
            required
          />
          <label>
            <span className="muted">כמות עותקים</span>
            <input type="number" name="copies" min="1" max="99" step="1" defaultValue="1" required />
          </label>
          <button type="submit">שלח להדפסה</button>
        </form>
      </section>

      <section className="card">
        <h3>תור הדפסה</h3>
        {!jobs.length ? (
          <p className="muted">אין כרגע מסמכים בתור ההדפסה.</p>
        ) : (
          <div className="desktop-table">
            <table>
              <thead>
                <tr>
                  <th>קובץ</th>
                  <th>גודל</th>
                  <th>עותקים</th>
                  <th>סטטוס</th>
                  <th>נשלח על ידי</th>
                  <th>נוצר</th>
                  <th>נאסף</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td>{job.fileName}</td>
                    <td>{formatSize(job.fileSizeBytes)}</td>
                    <td>{job.copies}</td>
                    <td>{statusLabel(job.status)}</td>
                    <td>{job.uploadedByDisplayName}{job.uploadedByEmail ? ` | ${job.uploadedByEmail}` : ""}</td>
                    <td>{formatDateTime(job.createdAt)}</td>
                    <td>{formatDateTime(job.claimedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
