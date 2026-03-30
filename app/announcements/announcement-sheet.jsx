"use client";

import { announcementBodyStyleObject } from "../../lib/announcement-layout";
import { useEffect, useRef, useState } from "react";

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
  const sheetRef = useRef(null);
  const [scale, setScale] = useState(1);
  const bodyLayout = layout?.body || {};
  const html = clean(bodyHtml) || buildFallbackHtml(bodyText || placeholderText);
  const style = announcementBodyStyleObject(bodyLayout);

  useEffect(() => {
    if (printMode) return undefined;
    const element = sheetRef.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;

    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect?.width || 794;
      setScale(Math.min(1, width / 794));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [printMode]);

  return (
    <div
      ref={sheetRef}
      className={`announcement-sheet${printMode ? " announcement-sheet-print" : ""}`}
      dir="rtl"
      style={{ "--announcement-sheet-scale": scale }}
    >
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
