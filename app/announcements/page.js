import Link from "next/link";
import { redirect } from "next/navigation";
import { listAnnouncements, listAnnouncementTemplates } from "../../lib/announcements";
import { requireAuthenticatedUser } from "../../lib/rbac";
import AnnouncementEditorClient from "./announcement-editor-client";
import { createAnnouncementAction, createAnnouncementTemplateAction } from "./actions";

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
      </div>

      {errorText ? <div className="card muted">{errorText}</div> : null}

      <div className="grid announcements-layout">
        <div className="card glass">
          <h3>תבנית חדשה</h3>
          <p className="muted">התבנית שומרת header/footer קבועים, בלנק רקע ותשמש אחר כך לכל מודעה חדשה.</p>
          <form action={createAnnouncementTemplateAction} className="grid">
            <div>
              <label>שם תבנית</label>
              <input name="name" placeholder="למשל: שיעור כללי" required />
            </div>
            <div>
              <label>כותרת עליונה קבועה</label>
              <textarea name="headerText" placeholder="נשמר בתוך התבנית" />
            </div>
            <div>
              <label>כותרת תחתונה קבועה</label>
              <textarea name="footerText" placeholder="למשל שם הרב / שורת סיום" />
            </div>
            <div className="template-layout-grid">
              <div>
                <label>גודל פונט כותרת עליונה</label>
                <input type="number" name="headerFontSize" min="14" max="56" defaultValue="30" />
              </div>
              <div>
                <label>יישור כותרת עליונה</label>
                <select name="headerAlign" defaultValue="center">
                  <option value="right">ימין</option>
                  <option value="center">מרכז</option>
                  <option value="left">שמאל</option>
                </select>
              </div>
              <div>
                <label>גודל פונט גוף</label>
                <input type="number" name="bodyFontSize" min="14" max="48" defaultValue="24" />
              </div>
              <div>
                <label>משקל פונט גוף</label>
                <input type="number" name="bodyFontWeight" min="300" max="900" step="100" defaultValue="400" />
              </div>
              <div>
                <label>ריווח שורות</label>
                <input type="number" name="bodyLineHeight" min="1" max="2.4" step="0.05" defaultValue="1.55" />
              </div>
              <div>
                <label>יישור גוף</label>
                <select name="bodyAlign" defaultValue="center">
                  <option value="right">ימין</option>
                  <option value="center">מרכז</option>
                  <option value="left">שמאל</option>
                </select>
              </div>
              <div>
                <label>התחלת גוף (%)</label>
                <input type="number" name="bodyTop" min="10" max="60" defaultValue="27" />
              </div>
              <div>
                <label>שול ימין גוף (%)</label>
                <input type="number" name="bodyRight" min="3" max="25" defaultValue="10" />
              </div>
              <div>
                <label>שול שמאל גוף (%)</label>
                <input type="number" name="bodyLeft" min="3" max="25" defaultValue="10" />
              </div>
              <div>
                <label>סיום גוף מלמטה (%)</label>
                <input type="number" name="bodyBottom" min="5" max="35" defaultValue="18" />
              </div>
              <div>
                <label>גודל פונט כותרת תחתונה</label>
                <input type="number" name="footerFontSize" min="14" max="48" defaultValue="26" />
              </div>
              <div>
                <label>יישור כותרת תחתונה</label>
                <select name="footerAlign" defaultValue="center">
                  <option value="right">ימין</option>
                  <option value="center">מרכז</option>
                  <option value="left">שמאל</option>
                </select>
              </div>
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
          <h3>מודעה חדשה</h3>
          <p className="muted">במודעה בוחרים תבנית קיימת ומזינים רק כותרת פנימית לניהול וגוף טקסט.</p>
          <form action={createAnnouncementAction} className="grid">
            <div>
              <label>תבנית</label>
              <select name="templateId" defaultValue="" required>
                <option value="">בחר תבנית קיימת</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>{template.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label>כותרת לניהול</label>
              <input name="title" placeholder="שם פנימי לחיפוש וניהול" required />
            </div>
            <div>
              <label>תאריך</label>
              <input type="date" name="announcementDate" />
            </div>
            <div>
              <label>גוף הטקסט</label>
              <AnnouncementEditorClient namePrefix="body" initialText="" initialHtml="" />
            </div>
            <button type="submit" disabled={!templates.length}>צור מודעה</button>
          </form>
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
                  <div className="muted">{template.headerText || "ללא כותרת עליונה"}</div>
                </div>
                <div className="announcement-row-meta">
                  <span className="meta-chip">{template.blankObjectKey ? "כולל בלנק" : "ללא בלנק"}</span>
                  <span className="muted">{template.footerText || "ללא כותרת תחתונה"}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
