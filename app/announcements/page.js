import Link from "next/link";
import { redirect } from "next/navigation";
import { listAnnouncements, listAnnouncementTemplates } from "../../lib/announcements";
import { requireAuthenticatedUser } from "../../lib/rbac";
import { createQueuedAnnouncementAction, updateAnnouncementTemplateGoogleDocsAction } from "./actions";
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

function fullGoogleDocsId(value) {
  return clean(value) || "לא נשמר ID";
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
  const templateUpdated = clean(resolvedSearchParams?.templateUpdated) === "1";

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
      {templateUpdated ? <div className="ok">התבנית נשמרה.</div> : null}
      {errorText ? <div className="card muted">{errorText}</div> : null}

      <div className="card glass">
        <AnnouncementGeneratorClient templates={templates} action={createQueuedAnnouncementAction} />
      </div>

      {user.is_super_admin ? (
        <div className="card glass">
          <div className="student-topbar">
            <div>
              <h3>ניהול תבניות Google Docs</h3>
              <p className="muted">סופר־אדמין יכול לשמור קישור Google Docs ולערוך את מיפוי השדות. ה־Document ID והשדות נשלחים תמיד לשרת הפנימי בכל יצירת מודעה.</p>
            </div>
          </div>
          <div className="announcement-template-docs-list">
            {templates.map((template) => {
              const fieldRows = [...(template.fields || []), {}, {}];
              return (
                <details key={template.id} className="announcement-template-admin-card">
                  <summary>
                    <span>
                      <strong>{template.name}</strong>
                      <small>{template.generatorName || template.templateKey}</small>
                    </span>
                    <span className="meta-chip">{template.googleDocsId ? `ID: ${template.googleDocsId.slice(0, 12)}...` : "חסר Google Docs ID"}</span>
                  </summary>
                  <form action={updateAnnouncementTemplateGoogleDocsAction} className="announcement-template-admin-form">
                    <input type="hidden" name="templateId" value={template.id} />
                    <input type="hidden" name="fieldCount" value={fieldRows.length} />

                    <div className="announcement-template-docs-row">
                      <div>
                        <strong>{template.templateKey}</strong>
                        <div className="muted">generatorName: {template.generatorName || "-"}</div>
                      </div>
                      <label>
                        <span>קישור Google Docs</span>
                        <input name="googleDocsUrl" defaultValue={template.googleDocsUrl || ""} placeholder="https://docs.google.com/document/d/..." />
                      </label>
                      <div className="announcement-template-docs-meta">
                        <span className="meta-chip">{fullGoogleDocsId(template.googleDocsId)}</span>
                      </div>
                    </div>

                    <div className="announcement-template-fields-editor">
                      <div className="announcement-template-fields-head">
                        <span>שדה במערכת</span>
                        <span>ID בתבנית Google Docs</span>
                        <span>תיאור/תווית למשתמש</span>
                        <span>סוג</span>
                        <span>חובה</span>
                        <span>מגבלת אורך</span>
                      </div>
                      {fieldRows.map((field, index) => (
                        <div key={`${template.id}-${index}`} className="announcement-template-field-row">
                          <input name={`fieldKey:${index}`} defaultValue={field.key || ""} placeholder="body" />
                          <input name={`fieldTemplateFieldId:${index}`} defaultValue={field.templateFieldId || ""} placeholder="7 / data / name" />
                          <input name={`fieldLabel:${index}`} defaultValue={field.label || ""} placeholder="תוכן המודעה" />
                          <select name={`fieldType:${index}`} defaultValue={field.type || "text"}>
                            <option value="text">טקסט קצר</option>
                            <option value="multiline">טקסט ארוך</option>
                          </select>
                          <label className="checkbox-inline">
                            <input name={`fieldRequired:${index}`} type="checkbox" defaultChecked={field.required === true} />
                            <span>חובה</span>
                          </label>
                          <input name={`fieldMaxLength:${index}`} type="number" min="1" defaultValue={field.maxLength || ""} placeholder="1500" />
                        </div>
                      ))}
                    </div>

                    <div className="announcement-template-admin-actions">
                      <button type="submit" className="btn">שמור תבנית</button>
                    </div>
                  </form>
                </details>
              );
            })}
          </div>
        </div>
      ) : null}

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
