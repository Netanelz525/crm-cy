import Link from "next/link";
import { redirect } from "next/navigation";
import PendingSubmitButton from "../../components/pending-submit-button";
import { canUsePrintQueue, listPrintJobs, listPrintUsageByUser, MAX_PRINT_FILE_BYTES } from "../../lib/print-jobs";
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
    case "completed":
      return "הושלם ונשמר לרישום";
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
  const isSuperAdmin = Boolean(user.is_super_admin);
  const [jobs, usageByUser] = await Promise.all([
    isSuperAdmin ? listPrintJobs({ limit: 50 }) : Promise.resolve([]),
    isSuperAdmin ? listPrintUsageByUser({ limit: 30 }) : Promise.resolve([])
  ]);
  const pendingJobs = jobs.filter((job) => job.status === "pending").length;
  const claimedJobs = jobs.filter((job) => job.status === "claimed").length;
  const completedJobs = jobs.filter((job) => job.status === "completed").length;
  const totalTrackedPages = user.is_super_admin
    ? usageByUser.reduce((sum, row) => sum + row.totalPrintPages, 0)
    : 0;

  return (
    <>
      <div className="card glass print-hero">
        <div>
          <h1>שליחה להדפסה</h1>
          <p className="muted">
            מעלים מסמך עד {formatSize(MAX_PRINT_FILE_BYTES)}. המסמך נשמר זמנית ב-Neon עד שהשרת המקומי אוסף אותו, שולח אישור במייל ושומר את נתוני ההדפסה לכרטיסיות עתידיות.
          </p>
        </div>
        <div className="quick-actions">
          {!user.is_print_only ? <Link className="quick-action-btn quick-action-outline" href="/neon">חזרה לתלמידים</Link> : null}
          {isSuperAdmin ? <Link className="quick-action-btn quick-action-outline" href="/admin/api-access">טוקנים לשרת מקומי</Link> : null}
        </div>
      </div>

      {uploaded ? <div className="ok">המסמך נשלח לתור ההדפסה.</div> : null}
      {error ? <div className="error">{error}</div> : null}

      <section className="print-dashboard-grid">
        <div className="card print-upload-card">
          <h3>מסמך חדש להדפסה</h3>
          <form action={createPrintJobAction} className="print-upload-form">
            <label className="print-file-drop">
              <span>בחר קובץ</span>
              <small>PDF, Word, Excel, תמונה או TXT</small>
              <input
                type="file"
                name="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.txt"
                required
              />
            </label>
            <label>
              <span className="muted">כמות עותקים</span>
              <input type="number" name="copies" min="1" max="99" step="1" defaultValue="1" required />
            </label>
            <PendingSubmitButton className="quick-action-btn quick-action-primary" pendingText="שולח להדפסה...">
              שלח להדפסה
            </PendingSubmitButton>
          </form>
        </div>

        {isSuperAdmin ? (
          <div className="card print-stats-card">
            <h3>מצב התור</h3>
            <div className="print-stat-grid">
              <div><b>{pendingJobs}</b><span>ממתינים</span></div>
              <div><b>{claimedJobs}</b><span>נאספו</span></div>
              <div><b>{completedJobs}</b><span>הושלמו</span></div>
              <div><b>{totalTrackedPages}</b><span>עמודים רשומים</span></div>
            </div>
          </div>
        ) : null}
      </section>

      {isSuperAdmin ? (
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
                    <th>עמודים</th>
                    <th>סה"כ</th>
                    <th>סטטוס</th>
                    <th>מייל אישור</th>
                    <th>נשלח על ידי</th>
                    <th>נוצר</th>
                    <th>עודכן</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr key={job.id}>
                      <td>{job.fileName}</td>
                      <td>{formatSize(job.fileSizeBytes)}</td>
                      <td>{job.copies}</td>
                      <td>{job.pageCount || "-"}</td>
                      <td>{job.printedPageCount || (job.pageCount ? job.pageCount * job.copies : "-")}</td>
                      <td>{statusLabel(job.status)}</td>
                      <td>{job.receiptSentAt ? "נשלח" : job.receiptError ? "נכשל" : "-"}</td>
                      <td>{job.uploadedByDisplayName}{job.uploadedByEmail ? ` | ${job.uploadedByEmail}` : ""}</td>
                      <td>{formatDateTime(job.createdAt)}</td>
                      <td>{formatDateTime(job.completedAt || job.claimedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {isSuperAdmin ? (
        <section className="card">
          <h3>ספירת עמודים לפי משתמש</h3>
          {!usageByUser.length ? (
            <p className="muted">עדיין אין נתוני הדפסה לפי משתמש.</p>
          ) : (
            <div className="print-usage-grid">
              {usageByUser.map((row) => (
                <div key={row.uploadedByUserId || row.uploadedByEmail || row.uploadedByDisplayName} className="linked-record-card">
                  <div className="linked-record-card-top">
                    <b>{row.uploadedByDisplayName}</b>
                    <span className="linked-record-pill">{row.totalPrintPages} עמודים</span>
                  </div>
                  <div className="linked-record-meta">{row.uploadedByEmail || "-"}</div>
                  <div className="linked-record-meta">עבודות: {row.jobsCount} | הושלמו: {row.completedJobsCount}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}
