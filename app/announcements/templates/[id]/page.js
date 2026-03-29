import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAnnouncementTemplateById } from "../../../../lib/announcements";
import { requireAuthenticatedUser } from "../../../../lib/rbac";
import { updateAnnouncementTemplateAction } from "../../actions";

function clean(value) {
  return String(value || "").trim();
}

export default async function AnnouncementTemplatePage({ params, searchParams }) {
  const user = await requireAuthenticatedUser();
  if (!user.is_team_member && !user.is_manager) {
    redirect("/unauthorized");
  }

  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const template = await getAnnouncementTemplateById(resolvedParams.id);
  if (!template) notFound();

  const created = clean(resolvedSearchParams?.created) === "1";
  const updated = clean(resolvedSearchParams?.updated) === "1";
  const errorText = clean(resolvedSearchParams?.error);

  return (
    <>
      <div className="card glass">
        <div className="student-topbar">
          <div>
            <h1>תבנית הודעה</h1>
            <div className="student-meta-line">
              <span className="meta-chip">{template.name}</span>
              <span className="meta-chip">{template.blankObjectKey ? "כולל בלנק רקע" : "ללא בלנק רקע"}</span>
            </div>
          </div>
          <div className="student-actions student-actions-wrap">
            <Link className="btn btn-ghost" href="/announcements">חזרה להודעות</Link>
          </div>
        </div>
      </div>

      {created ? <div className="ok">התבנית נוצרה ונשמרה.</div> : null}
      {updated ? <div className="ok">התבנית עודכנה.</div> : null}
      {errorText ? <div className="card muted">{errorText}</div> : null}

      <div className="grid announcements-layout">
        <div className="card glass">
          <h3>עריכת תבנית</h3>
          <form action={updateAnnouncementTemplateAction} className="grid">
            <input type="hidden" name="templateId" value={template.id} />
            <div>
              <label>שם תבנית</label>
              <input name="name" defaultValue={template.name} required />
            </div>
            <div>
              <label>כותרת עליונה</label>
              <textarea name="headerText" defaultValue={template.headerText} />
            </div>
            <div>
              <label>כותרת תחתונה</label>
              <textarea name="footerText" defaultValue={template.footerText} />
            </div>
            <div>
              <label>החלפת בלנק</label>
              <input type="file" name="blankFile" accept=".png,.jpg,.jpeg,.webp" />
            </div>
            <button type="submit">שמור תבנית</button>
          </form>
        </div>

        <div className="card glass">
          <h3>מקדימה לתבנית</h3>
          <div className="announcement-preview-shell">
            <div className="announcement-sheet">
              {template.blankObjectKey ? <img className="announcement-blank-image" src={`/api/announcements/templates/${template.id}/blank`} alt="" /> : null}
              {template.headerText ? <div className="announcement-region announcement-header">{template.headerText}</div> : null}
              <div className="announcement-region announcement-body announcement-rich-body">
                <p>כאן יופיע גוף הטקסט של המודעה כשתשתמשו בתבנית הזו.</p>
              </div>
              {template.footerText ? <div className="announcement-region announcement-footer">{template.footerText}</div> : null}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
