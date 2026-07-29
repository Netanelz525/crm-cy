import Link from "next/link";
import { redirect } from "next/navigation";
import { listAnnouncements, listAnnouncementTemplates } from "../../lib/announcements";
import { requireAuthenticatedUser } from "../../lib/rbac";
import { createAnnouncementTemplateAction, createQueuedAnnouncementAction, updateAnnouncementTemplateGoogleDocsAction } from "./actions";
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
  if (!user.can_use_announcement_templates) {
    redirect("/unauthorized");
  }

  const resolvedSearchParams = await searchParams;
  const q = clean(resolvedSearchParams?.q);
  const errorText = clean(resolvedSearchParams?.error);
  const created = clean(resolvedSearchParams?.created) === "1";
  const templateUpdated = clean(resolvedSearchParams?.templateUpdated) === "1";
  const templateCreated = clean(resolvedSearchParams?.templateCreated) === "1";

  const [templates, announcements] = await Promise.all([
    listAnnouncementTemplates({ user }),
    listAnnouncements(q, { user })
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
      {templateCreated ? <div className="ok">התבנית החדשה נוצרה.</div> : null}
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
              const fieldRows = [...(template.fields || []), ...Array.from({ length: 8 }, () => ({}))];
              return (
                <details key={template.id} className="announcement-template-admin-card">
                  <summary>
                    <span>
                      <strong>{template.name}</strong>
                      <small>{template.generatorName || template.templateKey}{template.isPreferred ? " · מועדפת" : ""}</small>
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
                      <div className="announcement-template-role-access">
                        <strong>הגדרות תבנית</strong>
                        <label className="checkbox-inline">
                          <input name="isPreferred" type="checkbox" defaultChecked={template.isPreferred === true} />
                          <span>תבנית מועדפת</span>
                        </label>
                        <label className="checkbox-inline">
                          <input name="allowedRoles" value="marei_mekomot" type="checkbox" defaultChecked={(template.allowedRoles || []).includes("marei_mekomot")} />
                          <span>מאושר להרשאת מראה מקומות</span>
                        </label>
                      </div>
                      <div className="announcement-template-fields-title">
                        <strong>שדות התבנית</strong>
                        <span className="muted">אפשר לשנות שדות קיימים או למלא שורות ריקות כדי להוסיף שדות חדשים.</span>
                      </div>
                      <div className="announcement-template-fields-head">
                        <span>ID בתבנית Google Docs</span>
                        <span>תיאור/תווית למשתמש</span>
                      </div>
                      {fieldRows.map((field, index) => (
                        <div key={`${template.id}-${index}`} className="announcement-template-field-row">
                          <input type="hidden" name={`fieldKey:${index}`} defaultValue={field.key || ""} />
                          <input type="hidden" name={`fieldType:${index}`} defaultValue={field.type || ""} />
                          <input type="hidden" name={`fieldRequired:${index}`} defaultValue={field.required === false ? "0" : "1"} />
                          <input type="hidden" name={`fieldMaxLength:${index}`} defaultValue={field.maxLength || ""} />
                          <input name={`fieldTemplateFieldId:${index}`} defaultValue={field.templateFieldId || ""} placeholder="7 / data / name" />
                          <input name={`fieldLabel:${index}`} defaultValue={field.label || ""} placeholder="תוכן המודעה" />
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

          <details className="announcement-template-admin-card">
            <summary>
              <span>
                <strong>יצירת תבנית חדשה</strong>
                <small>Google Docs + שדות החלפה</small>
              </span>
              <span className="meta-chip">חדש</span>
            </summary>
            <form action={createAnnouncementTemplateAction} className="announcement-template-admin-form">
              <div className="announcement-template-create-grid">
                <label>
                  <span>שם תבנית</span>
                  <input name="name" required placeholder="מראה מקומות חדש" />
                </label>
                <label>
                  <span>קישור Google Docs</span>
                  <input name="googleDocsUrl" required placeholder="https://docs.google.com/document/d/..." />
                </label>
                <label>
                  <span>סוג</span>
                  <select name="category" defaultValue="sources">
                    <option value="sources">מראה מקומות</option>
                    <option value="announcement">מודעה</option>
                    <option value="letter">מכתב</option>
                  </select>
                </label>
              </div>
              <div className="announcement-template-role-access">
                <strong>הגדרות תבנית</strong>
                <label className="checkbox-inline">
                  <input name="isPreferred" type="checkbox" defaultChecked />
                  <span>תבנית מועדפת</span>
                </label>
                <label className="checkbox-inline">
                  <input name="allowedRoles" value="marei_mekomot" type="checkbox" defaultChecked />
                  <span>מאושר להרשאת מראה מקומות</span>
                </label>
              </div>
              <input type="hidden" name="fieldCount" value="6" />
              <div className="announcement-template-fields-editor">
                <div className="announcement-template-fields-head">
                  <span>ID בתבנית Google Docs</span>
                  <span>תיאור/תווית למשתמש</span>
                </div>
                {[0, 1, 2, 3, 4, 5].map((index) => (
                  <div key={`new-template-field-${index}`} className="announcement-template-field-row">
                    <input type="hidden" name={`fieldRequired:${index}`} value="1" />
                    <input name={`fieldTemplateFieldId:${index}`} placeholder={index === 0 ? "title" : "data / name / 7"} />
                    <input name={`fieldLabel:${index}`} placeholder={index === 0 ? "כותרת ראשית" : "תיאור למשתמש"} />
                  </div>
                ))}
              </div>
              <div className="announcement-template-admin-actions">
                <button type="submit" className="btn">צור תבנית</button>
              </div>
            </form>
          </details>
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
