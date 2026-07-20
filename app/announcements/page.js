import Link from "next/link";
import { redirect } from "next/navigation";
import { listAnnouncements, listAnnouncementTemplates } from "../../lib/announcements";
import { requireAuthenticatedUser } from "../../lib/rbac";
import { createQueuedAnnouncementAction } from "./actions";
import AnnouncementGeneratorClient from "./announcement-generator-client";

function clean(value) {
  return String(value || "").trim();
}

function formatDateTime(value) {
  const raw = clean(value);
  if (!raw) return "-";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
}

function statusLabel(value) {
  if (value === "completed") return "הושלם";
  if (value === "claimed") return "נאסף";
  if (value === "failed") return "שגיאה";
  if (value === "pending") return "בתור";
  return value || "נשמר";
}

function outputModeLabel(value) {
  return value === "print" ? "הדפסה" : "מייל בלבד";
}

export default async function AnnouncementsPage({ searchParams }) {
  const user = await requireAuthenticatedUser();
  if (!user.is_team_member && !user.is_manager) {
    redirect("/unauthorized");
  }

  const resolvedSearchParams = await searchParams;
  const q = clean(resolvedSearchParams?.q);
  const errorText = clean(resolvedSearchParams?.error);
  const created = clean(resolvedSearchParams?.created) === "1";

  const [templates, announcements] = await Promise.all([
    listAnnouncementTemplates(),
    listAnnouncements(q)
  ]);

  return (
    <>
      <div className="card glass">
        <div className="student-topbar">
          <div>
            <h1>יצירת מודעות</h1>
            <p className="muted">בחר תבנית, מלא את השדות, והמערכת תשמור רשומת מודעה, תיצור PDF ותשלח אותו לתור Cloudflare להמשך טיפול בשרת המקומי.</p>
          </div>
          <div className="student-actions student-actions-wrap">
            <Link className="btn btn-ghost" href="/">חזרה לתלמידים</Link>
          </div>
        </div>
        <div className="student-meta-line">
          <span className="meta-chip">תבניות פעילות: {templates.length}</span>
          <span className="meta-chip">מודעות שנוצרו: {announcements.length}</span>
        </div>
      </div>

      {created ? <div className="ok">המודעה נוצרה, נשמרה ונשלחה לתור השרת המקומי.</div> : null}
      {errorText ? <div className="card muted">{errorText}</div> : null}

      <div className="card glass">
        <AnnouncementGeneratorClient templates={templates} action={createQueuedAnnouncementAction} />
      </div>

      <div className="card glass">
        <div className="student-topbar">
          <div>
            <h3>מודעות שנוצרו</h3>
            <p className="muted">כל מודעה נשמרת עם סוג התבנית, השדות שנשלחו ומזהה עבודת ההדפסה.</p>
          </div>
          <form method="GET" className="announcements-search-form">
            <input name="q" defaultValue={q} placeholder="חפש לפי כותרת, תוכן או תבנית" />
            <button type="submit">חפש</button>
          </form>
        </div>

        {!announcements.length ? (
          <div className="muted">אין מודעות להצגה.</div>
        ) : (
          <div className="announcements-list">
            {announcements.map((announcement) => (
              <Link key={announcement.id} href={`/announcements/${announcement.id}`} className="announcement-row">
                <div>
                  <strong>{announcement.title}</strong>
                  <div className="muted">{announcement.templateName} · {announcement.templateGeneratorName || "local-pdf"}</div>
                </div>
                <div className="announcement-row-meta">
                  <span className="meta-chip">{statusLabel(announcement.printJobStatus)}</span>
                  <span className="meta-chip">{outputModeLabel(announcement.printJobOutputMode)}</span>
                  <span className="meta-chip">{formatDateTime(announcement.queuedAt || announcement.createdAt)}</span>
                  {announcement.printJobId ? <span className="muted">Job: {announcement.printJobId.slice(0, 8)}</span> : null}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
