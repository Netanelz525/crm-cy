import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canUseAnnouncementTemplate, getAnnouncementById, getAnnouncementTemplateById } from "../../../lib/announcements";
import { requireAuthenticatedUser } from "../../../lib/rbac";

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

export default async function AnnouncementPage({ params }) {
  const user = await requireAuthenticatedUser();
  if (!user.can_use_announcement_templates) {
    redirect("/unauthorized");
  }

  const resolvedParams = await params;
  const announcement = await getAnnouncementById(resolvedParams.id);
  if (!announcement) notFound();
  const template = await getAnnouncementTemplateById(announcement.templateId);
  if (!template || !canUseAnnouncementTemplate(user, template)) redirect("/unauthorized");

  const fieldEntries = Object.entries(announcement.templateFields || {}).filter(([, value]) => clean(value));

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
            </div>
          </div>
          <div className="student-actions student-actions-wrap">
            <Link className="btn btn-ghost" href="/announcements">חזרה למודעות</Link>
            <Link className="btn btn-primary" href={`/api/announcements/${announcement.id}/pdf`} target="_blank">פתח PDF</Link>
          </div>
        </div>
      </div>

      <div className="card glass">
        <h3>פרטי המודעה</h3>
        {announcement.printJobId ? <p className="muted">עבודת הדפסה: {announcement.printJobId}</p> : null}
        {!fieldEntries.length ? (
          <p className="muted">{announcement.bodyText}</p>
        ) : (
          <div className="announcement-record-fields">
            {fieldEntries.map(([key, value]) => (
              <div key={key} className="announcement-record-field">
                <strong>{key}</strong>
                <span>{clean(value)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
