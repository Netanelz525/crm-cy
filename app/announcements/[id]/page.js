import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canUseAnnouncementTemplate, getAnnouncementById, getAnnouncementTemplateById } from "../../../lib/announcements";
import { requireAuthenticatedUser } from "../../../lib/rbac";
import { updateQueuedAnnouncementAction } from "../actions";

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
  if (value === "claimed") return "נאסף על ידי השרת המקומי";
  if (value === "failed") return "שגיאה";
  if (value === "pending") return "בתור";
  return value || "נשמר";
}

function outputModeLabel(value) {
  return value === "print" ? "הדפסה" : "מייל בלבד";
}

function queuedLabel(value) {
  if (value === "print") return "המודעה נשמרה ונשלחה להדפסה מחדש.";
  if (value === "email") return "המודעה נשמרה ונשלחה במייל מחדש.";
  return "";
}

function creatorLabel(value) {
  return clean(value?.createdByDisplayName) || clean(value?.createdByEmail) || clean(value?.createdByUserId) || "לא ידוע";
}

export default async function AnnouncementPage({ params, searchParams }) {
  const user = await requireAuthenticatedUser();
  if (!user.can_use_announcement_templates) {
    redirect("/unauthorized");
  }

  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const announcement = await getAnnouncementById(resolvedParams.id);
  if (!announcement) notFound();
  const template = await getAnnouncementTemplateById(announcement.templateId);
  if (!template || !canUseAnnouncementTemplate(user, template)) redirect("/unauthorized");

  const errorText = clean(resolvedSearchParams?.error);
  const updated = clean(resolvedSearchParams?.updated) === "1";
  const queued = clean(resolvedSearchParams?.queued);
  const queuedMessage = queuedLabel(queued);
  const templateFields = template.fields || [];

  return (
    <>
      <div className="card glass">
        <div className="student-topbar">
          <div>
            <h1>{announcement.title}</h1>
            <div className="student-meta-line">
              <span className="meta-chip">{announcement.templateName}</span>
              <span className="meta-chip">{statusLabel(announcement.printJobStatus)}</span>
              <span className="meta-chip">{outputModeLabel(announcement.printJobOutputMode)}</span>
              <span className="meta-chip">{formatDateTime(announcement.queuedAt || announcement.createdAt)}</span>
              <span className="meta-chip">נוצר על ידי: {creatorLabel(announcement)}</span>
            </div>
          </div>
          <div className="student-actions student-actions-wrap">
            <Link className="btn btn-ghost" href="/announcements">חזרה למודעות</Link>
            <Link className="btn btn-primary" href={`/api/announcements/${announcement.id}/pdf`} target="_blank">פתח PDF</Link>
          </div>
        </div>
      </div>

      {updated && !queuedMessage ? <div className="ok">המודעה נשמרה.</div> : null}
      {queuedMessage ? <div className="ok">{queuedMessage}</div> : null}
      {errorText ? <div className="error">{errorText}</div> : null}

      <div className="card glass">
        <h3>עריכת הודעה</h3>
        {announcement.printJobId ? <p className="muted">עבודת הדפסה: {announcement.printJobId}</p> : null}
        <form action={updateQueuedAnnouncementAction} className="announcement-edit-form">
          <input type="hidden" name="announcementId" value={announcement.id} />

          <label>
            <span>שם רשומה / שם קובץ *</span>
            <input name="recordName" defaultValue={announcement.title} maxLength={140} required />
          </label>

          <div className="announcement-fields-grid">
            {templateFields.map((field) => (
              <label key={field.key} className={field.type === "multiline" ? "announcement-field-span" : ""}>
                <span>{field.label}{field.required ? " *" : ""}</span>
                {field.type === "multiline" ? (
                  <textarea
                    name={`field:${field.key}`}
                    rows={field.maxLength > 1200 ? 8 : 5}
                    maxLength={field.maxLength || undefined}
                    required={Boolean(field.required)}
                    defaultValue={clean(announcement.templateFields?.[field.key])}
                  />
                ) : (
                  <input
                    name={`field:${field.key}`}
                    maxLength={field.maxLength || undefined}
                    required={Boolean(field.required)}
                    defaultValue={clean(announcement.templateFields?.[field.key])}
                  />
                )}
              </label>
            ))}
          </div>

          <div className="announcement-print-options">
            <label>
              <span>סוג הדפסה עבור הדפסה מחדש</span>
              <select name="printPlan" defaultValue="corner-staple">
                <option value="corner-staple">A4 רגיל, הידוק פינה ימנית עליונה</option>
                <option value="duplex">A4 רגיל דו-צדדי</option>
                <option value="booklet">חוברת A3, קיפול והידוק</option>
                <option value="convert-pdf">המרת קובץ ל-PDF</option>
              </select>
            </label>
            <label>
              <span>כמות עותקים עבור הדפסה מחדש</span>
              <input type="number" name="copies" min="1" max="99" defaultValue="1" />
            </label>
          </div>

          <div className="announcement-edit-actions">
            <button type="submit" name="submitMode" value="save" className="btn btn-ghost">שמור בלבד</button>
            <button type="submit" name="submitMode" value="email" className="btn">שלח במייל מחדש</button>
            <button type="submit" name="submitMode" value="print" className="btn btn-primary">הדפס מחדש</button>
          </div>
        </form>
      </div>
    </>
  );
}
