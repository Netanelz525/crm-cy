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

function regionStyle(section, fallback, extras = {}) {
  return {
    top: section.top !== undefined ? `${clampPercent(section.top, fallback.top)}%` : undefined,
    bottom: section.bottom !== undefined ? `${clampPercent(section.bottom, fallback.bottom)}%` : undefined,
    right: `${clampPercent(section.right, fallback.right)}%`,
    left: `${clampPercent(section.left, fallback.left)}%`,
    fontSize: `${clampNumber(section.fontSize, fallback.fontSize, 12, 72)}px`,
    lineHeight: clampNumber(section.lineHeight, fallback.lineHeight || 1.4, 1, 2.4),
    textAlign: clean(section.textAlign) || fallback.textAlign,
    fontWeight: clampNumber(section.fontWeight, fallback.fontWeight || 400, 300, 900),
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

export default function AnnouncementSheet({ template, bodyText = "", bodyHtml = "", printMode = false, placeholderText = "" }) {
  const layout = template?.layout || {};
  const headerLayout = layout.header || {};
  const bodyLayout = layout.body || {};
  const footerLayout = layout.footer || {};
  const html = clean(bodyHtml) || buildFallbackHtml(bodyText || placeholderText);

  return (
    <div className={`announcement-sheet${printMode ? " announcement-sheet-print" : ""}`}>
      {template?.blankObjectKey ? <img className="announcement-blank-image" src={`/api/announcements/templates/${template.id}/blank`} alt="" /> : null}
      {template?.headerText ? (
        <div
          className="announcement-region announcement-header"
          style={regionStyle(headerLayout, { top: 9, left: 9, right: 9, fontSize: 30, textAlign: "center", fontWeight: 700, lineHeight: 1.3 })}
        >
          {template.headerText}
        </div>
      ) : null}
      <div
        className="announcement-region announcement-body announcement-rich-body"
        style={regionStyle(bodyLayout, { top: 27, bottom: 18, left: 10, right: 10, fontSize: 24, textAlign: "center", fontWeight: 400, lineHeight: 1.55 })}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {template?.footerText ? (
        <div
          className="announcement-region announcement-footer"
          style={regionStyle(footerLayout, { bottom: 8, left: 9, right: 9, fontSize: 26, textAlign: "center", fontWeight: 700, lineHeight: 1.3 })}
        >
          {template.footerText}
        </div>
      ) : null}
    </div>
  );
}
