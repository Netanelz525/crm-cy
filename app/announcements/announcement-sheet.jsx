function clean(value) {
  return String(value || "").trim();
}

function clampPercent(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(95, Math.max(0, numeric));
}

function clampNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

export function announcementBodyStyle(section, extras = {}) {
  return {
    top: `${clampPercent(section?.top, 27)}%`,
    bottom: `${clampPercent(section?.bottom, 18)}%`,
    right: `${clampPercent(section?.right, 10)}%`,
    left: `${clampPercent(section?.left, 10)}%`,
    fontSize: `${clampNumber(section?.fontSize, 24, 12, 72)}px`,
    lineHeight: clampNumber(section?.lineHeight, 1.55, 1, 2.4),
    textAlign: ["right", "center", "left"].includes(clean(section?.textAlign)) ? clean(section.textAlign) : "center",
    fontWeight: clampNumber(section?.fontWeight, 400, 300, 900),
    ...extras
  };
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
  const style = announcementBodyStyle(bodyLayout);

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
