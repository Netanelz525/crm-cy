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

export function announcementBodyStyleObject(section = {}, extras = {}, options = {}) {
  const scaleWithSheet = options.scaleWithSheet !== false;
  const fontSizeValue = clampNumber(section?.fontSize, 24, 12, 72);
  return {
    top: `${clampPercent(section?.top, 27)}%`,
    bottom: `${clampPercent(section?.bottom, 18)}%`,
    right: `${clampPercent(section?.right, 10)}%`,
    left: `${clampPercent(section?.left, 10)}%`,
    fontSize: scaleWithSheet ? `calc(${fontSizeValue}px * var(--announcement-sheet-scale, 1))` : `${fontSizeValue}px`,
    lineHeight: clampNumber(section?.lineHeight, 1.55, 1, 2.4),
    textAlign: ["right", "center", "left"].includes(clean(section?.textAlign)) ? clean(section.textAlign) : "center",
    fontWeight: clampNumber(section?.fontWeight, 400, 300, 900),
    ...extras
  };
}

export function announcementBodyStyleCss(section = {}) {
  const style = announcementBodyStyleObject(section, {}, { scaleWithSheet: false });
  return Object.entries(style)
    .map(([key, value]) => {
      const cssKey = key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
      return `${cssKey}:${value}`;
    })
    .join(";");
}
