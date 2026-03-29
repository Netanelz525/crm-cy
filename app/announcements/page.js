import Link from "next/link";
import { redirect } from "next/navigation";
import { listAnnouncements, listAnnouncementTemplates } from "../../lib/announcements";
import { requireAuthenticatedUser } from "../../lib/rbac";
import { createAnnouncementTemplateAction } from "./actions";

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

export default async function AnnouncementsPage({ searchParams }) {
  const user = await requireAuthenticatedUser();
  if (!user.is_team_member && !user.is_manager) {
    redirect("/unauthorized");
  }

  const resolvedSearchParams = await searchParams;
  const q = clean(resolvedSearchParams?.q);
  const errorText = clean(resolvedSearchParams?.error);

  const [templates, announcements] = await Promise.all([
    listAnnouncementTemplates(),
    listAnnouncements(q)
  ]);

  return (
    <>
      <div className="card glass">
        <div className="student-topbar">
          <div>
            <h1>הודעות</h1>
            <p className="muted">אזור מרוכז ליצירת תבניות ומודעות, עם תצוגת הדפסה שמותאמת לעבודה מהטלפון.</p>
          </div>
          <div className="student-actions student-actions-wrap">
            <Link className="btn btn-ghost" href="/">חזרה לתלמידים</Link>
          </div>
        </div>
        <div className="student-meta-line">
          <span className="meta-chip">תבניות פעילות: {templates.length}</span>
          <span className="meta-chip">מודעות שמורות: {announcements.length}</span>
        </div>
        <div className="student-actions student-actions-wrap">
          <Link className="btn btn-primary" href="/announcements/new">הודעה חדשה</Link>
        </div>
      </div>

      {errorText ? <div className="card muted">{errorText}</div> : null}

      <div className="grid announcements-layout">
        <div className="card glass">
          <h3>תבנית חדשה</h3>
          <p className="muted">התבנית שומרת רק את בלנק הרקע. כל עיצוב הטקסט יעבור למודעה עצמה.</p>
          <form action={createAnnouncementTemplateAction} className="grid">
            <div>
              <label>שם תבנית</label>
              <input name="name" placeholder="למשל: שיעור כללי" required />
            </div>
            <div>
              <label>הערה פנימית</label>
              <div className="muted">אין צורך להגדיר עיצוב טקסט בתבנית. התבנית תשמש כרקע בלבד.</div>
            </div>
            <div>
              <label>בלנק רקע</label>
              <input type="file" name="blankFile" accept=".png,.jpg,.jpeg,.webp" />
              <div className="muted">בשלב הראשון הבלנק הוא תמונה כדי לאפשר preview והדפסה פשוטים ונקיים.</div>
            </div>
            <button type="submit">שמור תבנית</button>
          </form>
        </div>

        <div className="card glass">
          <h3>מודעות</h3>
          <p className="muted">יצירת מודעה חדשה מתבצעת בעמוד ייעודי, כדי שכל ההגדרות והעריכה יהיו במקום אחד ברור.</p>
          <div className="student-actions student-actions-wrap">
            <Link className="btn btn-primary" href="/announcements/new">פתח עמוד מודעה חדשה</Link>
          </div>
          {!templates.length ? (
            <div className="muted">כדי ליצור מודעה צריך קודם לשמור לפחות תבנית אחת.</div>
          ) : null}
        </div>
      </div>

      <div className="card glass">
        <div className="student-topbar">
          <div>
            <h3>מודעות שמורות</h3>
            <p className="muted">חיפוש לפי כותרת, תוכן, או שם תבנית.</p>
          </div>
          <form method="GET" className="announcements-search-form">
            <input name="q" defaultValue={q} placeholder="חפש מודעה" />
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
                  <div className="muted">{announcement.templateName}</div>
                </div>
                <div className="announcement-row-meta">
                  <span className="meta-chip">{formatDate(announcement.announcementDate)}</span>
                  <span className="muted">{clean(announcement.bodyText).slice(0, 90)}{clean(announcement.bodyText).length > 90 ? "..." : ""}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="card glass">
        <h3>תבניות שמורות</h3>
        {!templates.length ? (
          <div className="muted">עדיין אין תבניות. צור תבנית ראשונה כדי להתחיל להכין מודעות.</div>
        ) : (
          <div className="announcements-list">
            {templates.map((template) => (
              <Link key={template.id} href={`/announcements/templates/${template.id}`} className="announcement-row">
                <div>
                  <strong>{template.name}</strong>
                  <div className="muted">{template.blankObjectKey ? "בלנק רקע שמור" : "ללא בלנק רקע"}</div>
                </div>
                <div className="announcement-row-meta">
                  <span className="meta-chip">{template.blankObjectKey ? "כולל בלנק" : "ללא בלנק"}</span>
                  <span className="muted">משמש כרקע בלבד</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
