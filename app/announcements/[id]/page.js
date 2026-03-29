import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAnnouncementById, getAnnouncementTemplateById, listAnnouncementTemplates } from "../../../lib/announcements";
import { requireAuthenticatedUser } from "../../../lib/rbac";
import AnnouncementEditorClient from "../announcement-editor-client";
import { updateAnnouncementAction } from "../actions";

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

export default async function AnnouncementPage({ params, searchParams }) {
  const user = await requireAuthenticatedUser();
  if (!user.is_team_member && !user.is_manager) {
    redirect("/unauthorized");
  }

  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const announcement = await getAnnouncementById(resolvedParams.id);
  if (!announcement) notFound();

  const [template, templates] = await Promise.all([
    getAnnouncementTemplateById(announcement.templateId),
    listAnnouncementTemplates()
  ]);

  const created = clean(resolvedSearchParams?.created) === "1";
  const updated = clean(resolvedSearchParams?.updated) === "1";
  const errorText = clean(resolvedSearchParams?.error);

  return (
    <>
      <div className="card glass">
        <div className="student-topbar">
          <div>
            <h1>מודעה</h1>
            <div className="student-meta-line">
              <span className="meta-chip">תבנית: {announcement.templateName}</span>
              <span className="meta-chip">תאריך: {formatDate(announcement.announcementDate)}</span>
            </div>
          </div>
          <div className="student-actions student-actions-wrap">
            <Link className="btn btn-ghost" href="/announcements">חזרה להודעות</Link>
            <Link className="btn btn-primary" href={`/announcements/${announcement.id}/print`} target="_blank">פתח להדפסה / PDF</Link>
          </div>
        </div>
      </div>

      {created ? <div className="ok">המודעה נוצרה ונשמרה.</div> : null}
      {updated ? <div className="ok">המודעה עודכנה.</div> : null}
      {errorText ? <div className="card muted">{errorText}</div> : null}

      <div className="grid announcements-layout">
        <div className="card glass">
          <h3>עריכת המודעה</h3>
          <form action={updateAnnouncementAction} className="grid">
            <input type="hidden" name="announcementId" value={announcement.id} />
            <div>
              <label>תבנית</label>
              <select name="templateId" defaultValue={announcement.templateId}>
                {templates.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label>כותרת לניהול</label>
              <input name="title" defaultValue={announcement.title} required />
            </div>
            <div>
              <label>תאריך</label>
              <input type="date" name="announcementDate" defaultValue={clean(announcement.announcementDate)} />
            </div>
            <div>
              <label>גוף הטקסט</label>
              <AnnouncementEditorClient
                namePrefix="body"
                initialText={announcement.bodyText}
                initialHtml={announcement.bodyHtml}
              />
            </div>
            <button type="submit">שמור שינויים</button>
          </form>
        </div>

        <div className="card glass">
          <h3>תצוגה מקדימה</h3>
          <div className="announcement-preview-shell">
            <div className="announcement-sheet">
              {template?.blankObjectKey ? <img className="announcement-blank-image" src={`/api/announcements/templates/${template.id}/blank`} alt="" /> : null}
              {template?.headerText ? <div className="announcement-region announcement-header">{template.headerText}</div> : null}
              <div className="announcement-region announcement-body announcement-rich-body" dangerouslySetInnerHTML={{ __html: announcement.bodyHtml || `<p>${announcement.bodyText}</p>` }} />
              {template?.footerText ? <div className="announcement-region announcement-footer">{template.footerText}</div> : null}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
