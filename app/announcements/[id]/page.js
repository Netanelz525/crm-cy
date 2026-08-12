import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canUseAnnouncementTemplate, getAnnouncementById, getAnnouncementTemplateById, listAnnouncementSignatures } from "../../../lib/announcements";
import { requireAuthenticatedUser } from "../../../lib/rbac";
import { canUseColorPrint } from "../../../lib/print-jobs";
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

function absoluteUrl(path) {
  const base = clean(process.env.CRM_BASE_URL || process.env.APP_BASE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL);
  const normalizedBase = /^https?:\/\//i.test(base) ? base : `https://${base || "crm-cy-nu.vercel.app"}`;
  return `${normalizedBase.replace(/\/$/, "")}${clean(path).startsWith("/") ? clean(path) : `/${clean(path)}`}`;
}

function signatureAssetUrl(signature) {
  const objectKey = clean(signature?.objectKey);
  if (!objectKey) return "";
  return absoluteUrl(`/api/announcements/assets/${encodeURIComponent(Buffer.from(objectKey).toString("base64url"))}`);
}

function imageFieldDefaults(value) {
  const image = value && typeof value === "object" && value.type === "image" ? value : null;
  const source = clean(image?.source);
  const url = clean(image?.url);
  const signatureId = clean(image?.signatureId);
  const signatureName = clean(image?.signatureName);
  return {
    source: source === "manual" || source === "signature" ? source : url ? "manual" : "signature",
    signatureId,
    signatureName,
    url,
    width: Number(image?.width || 180),
    height: Number(image?.height || 70)
  };
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
  const signatures = await listAnnouncementSignatures();
  const signatureOptions = signatures.map((signature) => ({
    ...signature,
    url: signatureAssetUrl(signature)
  }));

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
        <form action={updateQueuedAnnouncementAction} className="announcement-edit-form" encType="multipart/form-data">
          <input type="hidden" name="announcementId" value={announcement.id} />

          <label>
            <span>שם רשומה / שם קובץ *</span>
            <input name="recordName" defaultValue={announcement.title} maxLength={140} required />
          </label>

          <div className="announcement-fields-grid">
            {templateFields.map((field) => {
              const currentValue = announcement.templateFields?.[field.key];
              if (field.type === "image") {
                const defaults = imageFieldDefaults(currentValue);
                return (
                  <div key={field.key} className="announcement-image-field announcement-field-span">
                    <span>{field.label}</span>
                    <div className="announcement-image-field-grid">
                      <label>
                        <span className="muted">מקור תמונה</span>
                        <select name={`fieldImageSource:${field.key}`} defaultValue={defaults.source}>
                          <option value="signature">מאגר חתימות</option>
                          <option value="manual">קישור חיצוני</option>
                          <option value="upload">קובץ מצורף</option>
                        </select>
                      </label>
                      <label>
                        <span className="muted">חתימה מהמאגר</span>
                        <select name={`fieldSignatureId:${field.key}`} defaultValue={defaults.source === "signature" ? defaults.signatureId : ""}>
                          <option value="">בחר חתימה</option>
                          {signatureOptions.map((signature) => (
                            <option key={signature.id} value={signature.id}>
                              {signature.name} ({signature.width}×{signature.height})
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span className="muted">קישור חיצוני</span>
                        <input name={`fieldImageUrl:${field.key}`} defaultValue={defaults.source === "manual" ? defaults.url : ""} placeholder="https://example.com/signature.png" />
                      </label>
                      <label>
                        <span className="muted">קובץ תמונה</span>
                        <input name={`fieldImageFile:${field.key}`} type="file" accept="image/png,image/jpeg,image/webp,image/gif" />
                      </label>
                      <label>
                        <span className="muted">רוחב</span>
                        <input name={`fieldImageWidth:${field.key}`} type="number" min="1" max="2000" defaultValue={defaults.width} />
                      </label>
                      <label>
                        <span className="muted">גובה</span>
                        <input name={`fieldImageHeight:${field.key}`} type="number" min="1" max="2000" defaultValue={defaults.height} />
                      </label>
                    </div>
                    {defaults.source === "signature" && defaults.signatureName ? (
                      <div className="announcement-image-existing-preview" aria-label="חתימה קיימת">
                        <span>חתימה קיימת: {defaults.signatureName}</span>
                      </div>
                    ) : null}
                    {defaults.source === "manual" && defaults.url ? (
                      <a className="announcement-image-existing-preview" href={defaults.url} target="_blank" rel="noreferrer">
                        <img src={defaults.url} alt="" />
                        <span>פתח קישור חיצוני קיים</span>
                      </a>
                    ) : null}
                  </div>
                );
              }
              return (
                <label key={field.key} className={field.type === "multiline" ? "announcement-field-span" : ""}>
                  <span>{field.label}{field.required ? " *" : ""}</span>
                  {field.type === "multiline" ? (
                    <textarea
                      name={`field:${field.key}`}
                      rows={field.maxLength > 1200 ? 8 : 5}
                      maxLength={field.maxLength || undefined}
                      required={Boolean(field.required)}
                      defaultValue={clean(currentValue)}
                    />
                  ) : (
                    <input
                      name={`field:${field.key}`}
                      maxLength={field.maxLength || undefined}
                      required={Boolean(field.required)}
                      defaultValue={clean(currentValue)}
                    />
                  )}
                </label>
              );
            })}
          </div>

          <div className="announcement-print-options">
            <label>
              <span>סוג הדפסה עבור הדפסה מחדש</span>
              <select name="printPlan" defaultValue="corner-staple-bw">
                <option value="corner-staple-bw">שחור לבן, A4 הידוק פינה ימנית עליונה</option>
                <option value="duplex-bw">שחור לבן, A4 דו-צדדי</option>
                <option value="booklet-bw">שחור לבן, חוברת A3</option>
                <option value="single-a4-bw">שחור לבן, A4 צד אחד</option>
                <option value="single-a3-bw">שחור לבן, A3 צד אחד</option>
                {canUseColorPrint(user) ? <>
                  <option value="booklet-color">צבע, חוברת A3</option>
                  <option value="duplex-color">צבע, A4 דו-צדדי</option>
                  <option value="corner-staple-color">צבע, A4 הידוק פינה</option>
                  <option value="single-a4-color">צבע, A4 צד אחד</option>
                  <option value="single-a3-color">צבע, A3 צד אחד</option>
                </> : null}
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
