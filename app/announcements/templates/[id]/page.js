import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAnnouncementTemplateById } from "../../../../lib/announcements";
import { requireAuthenticatedUser } from "../../../../lib/rbac";
import AnnouncementSheet from "../../announcement-sheet";
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
            <div className="template-layout-grid">
              <div>
                <label>גודל פונט כותרת עליונה</label>
                <input type="number" name="headerFontSize" min="14" max="56" defaultValue={template.layout?.header?.fontSize || 30} />
              </div>
              <div>
                <label>יישור כותרת עליונה</label>
                <select name="headerAlign" defaultValue={template.layout?.header?.textAlign || "center"}>
                  <option value="right">ימין</option>
                  <option value="center">מרכז</option>
                  <option value="left">שמאל</option>
                </select>
              </div>
              <div>
                <label>גודל פונט גוף</label>
                <input type="number" name="bodyFontSize" min="14" max="48" defaultValue={template.layout?.body?.fontSize || 24} />
              </div>
              <div>
                <label>משקל פונט גוף</label>
                <input type="number" name="bodyFontWeight" min="300" max="900" step="100" defaultValue={template.layout?.body?.fontWeight || 400} />
              </div>
              <div>
                <label>ריווח שורות</label>
                <input type="number" name="bodyLineHeight" min="1" max="2.4" step="0.05" defaultValue={template.layout?.body?.lineHeight || 1.55} />
              </div>
              <div>
                <label>יישור גוף</label>
                <select name="bodyAlign" defaultValue={template.layout?.body?.textAlign || "center"}>
                  <option value="right">ימין</option>
                  <option value="center">מרכז</option>
                  <option value="left">שמאל</option>
                </select>
              </div>
              <div>
                <label>התחלת גוף (%)</label>
                <input type="number" name="bodyTop" min="10" max="60" defaultValue={template.layout?.body?.top || 27} />
              </div>
              <div>
                <label>שול ימין גוף (%)</label>
                <input type="number" name="bodyRight" min="3" max="25" defaultValue={template.layout?.body?.right || 10} />
              </div>
              <div>
                <label>שול שמאל גוף (%)</label>
                <input type="number" name="bodyLeft" min="3" max="25" defaultValue={template.layout?.body?.left || 10} />
              </div>
              <div>
                <label>סיום גוף מלמטה (%)</label>
                <input type="number" name="bodyBottom" min="5" max="35" defaultValue={template.layout?.body?.bottom || 18} />
              </div>
              <div>
                <label>גודל פונט כותרת תחתונה</label>
                <input type="number" name="footerFontSize" min="14" max="48" defaultValue={template.layout?.footer?.fontSize || 26} />
              </div>
              <div>
                <label>יישור כותרת תחתונה</label>
                <select name="footerAlign" defaultValue={template.layout?.footer?.textAlign || "center"}>
                  <option value="right">ימין</option>
                  <option value="center">מרכז</option>
                  <option value="left">שמאל</option>
                </select>
              </div>
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
            <AnnouncementSheet template={template} placeholderText="כאן יופיע גוף הטקסט של המודעה כשתשתמשו בתבנית הזו." />
          </div>
        </div>
      </div>
    </>
  );
}
