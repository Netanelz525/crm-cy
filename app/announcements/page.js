import Link from "next/link";
import { redirect } from "next/navigation";
import { listAnnouncements, listAnnouncementTemplates } from "../../lib/announcements";
import { requireAuthenticatedUser } from "../../lib/rbac";
import { createAnnouncementTemplateAction, createQueuedAnnouncementAction, updateAnnouncementTemplateGoogleDocsAction } from "./actions";
import AnnouncementGeneratorClient from "./announcement-generator-client";
import AnnouncementTemplateFieldsClient from "./announcement-template-fields-client";

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

function creatorLabel(value) {
  return clean(value?.createdByDisplayName) || clean(value?.createdByEmail) || clean(value?.createdByUserId) || "לא ידוע";
}

function googleDocsEditUrl(template) {
  const url = clean(template?.googleDocsUrl);
  if (/^https:\/\/docs\.google\.com\/document\/d\//.test(url)) return url;
  const id = clean(template?.googleDocsId);
  return id ? `https://docs.google.com/document/d/${id}/edit` : "";
}

export default async function AnnouncementsPage({ searchParams }) {
  const user = await requireAuthenticatedUser();
  if (!user.can_use_announcement_templates) {
    redirect("/unauthorized");
  }

  const resolvedSearchParams = await searchParams;
  const q = clean(resolvedSearchParams?.q);
  const selectedTemplateId = clean(resolvedSearchParams?.templateId);
  const errorText = clean(resolvedSearchParams?.error);
  const created = clean(resolvedSearchParams?.created) === "1";
  const templateUpdated = clean(resolvedSearchParams?.templateUpdated) === "1";
  const templateCreated = clean(resolvedSearchParams?.templateCreated) === "1";

  const [templates, announcements, announcementHistory] = await Promise.all([
    listAnnouncementTemplates({ user }),
    listAnnouncements(q, { user }),
    q ? listAnnouncements("", { user }) : Promise.resolve(null)
  ]);
  const allAnnouncements = announcementHistory || announcements;
  const announcementsByTemplateId = allAnnouncements.reduce((map, announcement) => {
    const templateId = clean(announcement.templateId);
    if (!templateId) return map;
    const current = map.get(templateId) || [];
    current.push(announcement);
    map.set(templateId, current);
    return map;
  }, new Map());

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

      <div className="card glass" id="create-announcement">
        <AnnouncementGeneratorClient
          templates={templates}
          action={createQueuedAnnouncementAction}
          initialTemplateId={selectedTemplateId}
        />
      </div>

      {user.is_super_admin ? (
        <details className="card glass announcement-section-card" open={templateUpdated || templateCreated}>
          <summary>
            <span>
              <h3>ניהול תבניות Google Docs</h3>
              <p className="muted">סופר־אדמין יכול לשמור קישור Google Docs ולערוך את מיפוי השדות. ה־Document ID והשדות נשלחים תמיד לשרת הפנימי בכל יצירת מודעה.</p>
            </span>
            <span className="meta-chip">תבניות: {templates.length}</span>
          </summary>
          <div className="announcement-template-docs-list">
            {templates.map((template) => {
              const docsUrl = googleDocsEditUrl(template);
              const templateAnnouncements = announcementsByTemplateId.get(template.id) || [];
              return (
                <details key={template.id} className="announcement-template-admin-card">
                  <summary>
                    <span>
                      <strong>{template.name}</strong>
                      <small>{template.generatorName || template.templateKey}</small>
                    </span>
                    <span className="announcement-template-summary-actions">
                      <Link className="btn btn-primary" href={`/announcements?templateId=${encodeURIComponent(template.id)}#create-announcement`}>צור מודעה מתבנית זו</Link>
                      {docsUrl ? <a className="btn btn-ghost" href={docsUrl} target="_blank" rel="noreferrer">פתח ב־Google Docs</a> : null}
                      <span className="meta-chip">נוצרו: {templateAnnouncements.length}</span>
                      <span className="meta-chip">{template.googleDocsId ? `ID: ${template.googleDocsId.slice(0, 12)}...` : "חסר Google Docs ID"}</span>
                    </span>
                  </summary>
                  <form action={updateAnnouncementTemplateGoogleDocsAction} className="announcement-template-admin-form">
                    <input type="hidden" name="templateId" value={template.id} />

                    <div className="announcement-template-docs-row">
                      <div>
                        <strong>{template.templateKey}</strong>
                        <div className="muted">generatorName: {template.generatorName || "-"}</div>
                      </div>
                      <label>
                        <span>שם התבנית</span>
                        <input name="name" defaultValue={template.name || ""} placeholder="שם להצגה במערכת" required />
                      </label>
                      <label>
                        <span>קישור Google Docs</span>
                        <input name="googleDocsUrl" defaultValue={template.googleDocsUrl || ""} placeholder="https://docs.google.com/document/d/..." />
                      </label>
                      <div className="announcement-template-docs-meta">
                        {docsUrl ? <a className="btn btn-ghost" href={docsUrl} target="_blank" rel="noreferrer">ערוך תבנית מלאה</a> : null}
                        <span className="meta-chip">{fullGoogleDocsId(template.googleDocsId)}</span>
                      </div>
                    </div>

                    <div className="announcement-template-fields-editor">
                      <div className="announcement-template-role-access">
                        <strong>הגדרות תבנית</strong>
                        <input type="hidden" name="isPreferred" value={template.isPreferred ? "on" : ""} />
                        <label className="checkbox-inline">
                          <input name="allowedRoles" value="marei_mekomot" type="checkbox" defaultChecked={(template.allowedRoles || []).includes("marei_mekomot")} />
                          <span>מאושר להרשאת מראה מקומות</span>
                        </label>
                      </div>
                      <AnnouncementTemplateFieldsClient fields={template.fields || []} />
                    </div>

                    <div className="announcement-template-admin-actions">
                      <button type="submit" className="btn">שמור תבנית</button>
                    </div>
                  </form>

                  <div className="announcement-template-history">
                    <div className="announcement-template-history-title">
                      <strong>היסטוריית מודעות מתבנית זו</strong>
                      <span className="meta-chip">{templateAnnouncements.length} רשומות</span>
                    </div>
                    {templateAnnouncements.length ? (
                      <div className="announcement-template-history-list">
                        {templateAnnouncements.slice(0, 8).map((announcement) => (
                          <Link key={announcement.id} href={`/announcements/${announcement.id}`} className="announcement-template-history-row">
                            <span>
                              <strong>{announcement.title}</strong>
                              <small>נוצר על ידי: {creatorLabel(announcement)}</small>
                            </span>
                            <span className="announcement-row-meta">
                              <span className="meta-chip">{statusLabel(announcement.printJobStatus)}</span>
                              <span className="meta-chip">{outputModeLabel(announcement.printJobOutputMode)}</span>
                              <span className="muted">{formatDateTime(announcement.queuedAt || announcement.createdAt)}</span>
                            </span>
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <div className="muted">עדיין לא נוצרו מודעות מהתבנית הזו.</div>
                    )}
                  </div>
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
                <input type="hidden" name="isPreferred" value="" />
                <label className="checkbox-inline">
                  <input name="allowedRoles" value="marei_mekomot" type="checkbox" defaultChecked />
                  <span>מאושר להרשאת מראה מקומות</span>
                </label>
              </div>
              <AnnouncementTemplateFieldsClient minRows={1} />
              <div className="announcement-template-admin-actions">
                <button type="submit" className="btn">צור תבנית</button>
              </div>
            </form>
          </details>
        </details>
      ) : null}

      <details className="card glass announcement-section-card" open={Boolean(q)}>
        <summary>
          <span>
            <h3>מודעות שנוצרו</h3>
            <p className="muted">כל מודעה נשמרת עם סוג התבנית, השדות שנשלחו ומזהה עבודת ההדפסה.</p>
          </span>
          <span className="meta-chip">רשומות: {announcements.length}</span>
        </summary>
        <div className="announcement-section-body">
          <form method="GET" className="announcements-search-form">
            <input name="q" defaultValue={q} placeholder="חפש לפי כותרת, תוכן או תבנית" />
            <button type="submit">חפש</button>
          </form>

          {!announcements.length ? (
            <div className="muted">אין מודעות להצגה.</div>
          ) : (
            <div className="announcements-list">
              {announcements.map((announcement) => (
                <Link key={announcement.id} href={`/announcements/${announcement.id}`} className="announcement-row">
                  <div>
                    <strong>{announcement.title}</strong>
                    <div className="muted">{announcement.templateName} · {announcement.templateGeneratorName || "local-pdf"}</div>
                    <div className="muted">נוצר על ידי: {creatorLabel(announcement)}</div>
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
      </details>
    </>
  );
}
