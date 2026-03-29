"use client";

import { useMemo, useState } from "react";
import AnnouncementEditorClient from "./announcement-editor-client";
import LayoutControlsClient from "./layout-controls-client";

function clean(value) {
  return String(value || "").trim();
}

const DEFAULT_LAYOUT = {
  body: {
    fontSize: 24,
    lineHeight: 1.55,
    textAlign: "center",
    top: 27,
    bottom: 18,
    right: 10,
    left: 10
  }
};

export default function AnnouncementComposerClient({
  action,
  templates,
  initialAnnouncement = null,
  submitLabel,
  submitDisabled = false,
  footerActions = null,
  flowTitle = ""
}) {
  const [templateId, setTemplateId] = useState(initialAnnouncement?.templateId || "");
  const [layout, setLayout] = useState(initialAnnouncement?.layoutOverride || DEFAULT_LAYOUT);

  const selectedTemplate = useMemo(
    () => templates.find((item) => item.id === templateId) || null,
    [templates, templateId]
  );

  return (
    <form action={action} className="grid">
      {initialAnnouncement?.id ? <input type="hidden" name="announcementId" value={initialAnnouncement.id} /> : null}

      {flowTitle ? (
        <div className="announcement-flow-bar">
          <span className="announcement-flow-step active">1. פרטי מודעה</span>
          <span className="announcement-flow-sep">/</span>
          <span className="announcement-flow-step active">2. אזור טקסט</span>
          <span className="announcement-flow-sep">/</span>
          <span className="announcement-flow-step active">3. עריכה ושמירה</span>
        </div>
      ) : null}

      <div>
        <label>תבנית</label>
        <select name="templateId" value={templateId} onChange={(event) => setTemplateId(event.target.value)} required>
          {!initialAnnouncement ? <option value="">בחר תבנית קיימת</option> : null}
          {templates.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label>כותרת לניהול</label>
        <input name="title" defaultValue={clean(initialAnnouncement?.title)} placeholder="שם פנימי לחיפוש וניהול" required />
      </div>

      <div>
        <label>תאריך</label>
        <input type="date" name="announcementDate" defaultValue={clean(initialAnnouncement?.announcementDate)} />
      </div>

      <LayoutControlsClient initialLayout={layout} onChange={setLayout} />

      <div>
        <label>גוף המודעה</label>
        <AnnouncementEditorClient
          namePrefix="body"
          initialText={initialAnnouncement?.bodyText || ""}
          initialHtml={initialAnnouncement?.bodyHtml || ""}
          template={selectedTemplate}
          layout={layout}
        />
      </div>

      <div className="announcement-action-spacer" />
      <div className="announcement-bottom-bar">
        <div className="announcement-bottom-actions">
          {footerActions}
          <button type="submit" className="btn btn-primary announcement-bottom-submit" disabled={submitDisabled}>{submitLabel}</button>
        </div>
      </div>
    </form>
  );
}
