import { announcementBodyStyleObject } from "../../lib/announcement-layout";

function clean(value) {
  return String(value || "").trim();
}

function buildFallbackHtml(bodyText) {
  const safe = clean(bodyText)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<p>${safe.replace(/\n/g, "<br>")}</p>`;
}

export default function AnnouncementSheet({ template, bodyText = "", bodyHtml = "", layout = {}, printMode = false, placeholderText = "", editableContent = null }) {
  const bodyLayout = layout?.body || {};
  const html = clean(bodyHtml) || buildFallbackHtml(bodyText || placeholderText);
  const style = announcementBodyStyleObject(bodyLayout);

  return (
    <div className={`announcement-sheet${printMode ? " announcement-sheet-print" : ""}`} dir="rtl">
      {template?.blankObjectKey ? <img className="announcement-blank-image" src={`/api/announcements/templates/${template.id}/blank`} alt="" /> : null}
      {editableContent ? (
        <div className="announcement-region announcement-body announcement-body-edit-host" style={style}>
          {editableContent}
        </div>
      ) : (
        <div
          className="announcement-region announcement-body announcement-rich-body"
          style={style}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}
