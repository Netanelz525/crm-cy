"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import AnnouncementEditorClient from "./announcement-editor-client";
import LayoutControlsClient from "./layout-controls-client";
import AnnouncementSheet from "./announcement-sheet";
import { updateAnnouncementAction } from "./actions";

function clean(value) {
  return String(value || "").trim();
}

function formatDate(value) {
  const raw = clean(value);
  if (!raw) return "-";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString("he-IL");
}

export default function AnnouncementEditClient({ announcement, templates, initialTemplate, created, updated, errorText }) {
  const [templateId, setTemplateId] = useState(announcement.templateId);
  const [editorState, setEditorState] = useState({
    html: announcement.bodyHtml || "",
    text: announcement.bodyText || ""
  });
  const [layout, setLayout] = useState(announcement.layoutOverride || {});

  const selectedTemplate = useMemo(
    () => templates.find((item) => item.id === templateId) || initialTemplate,
    [templates, templateId, initialTemplate]
  );

  return (
    <>
      <div className="card glass">
        <div className="student-topbar">
          <div>
            <h1>מודעה</h1>
            <div className="student-meta-line">
              <span className="meta-chip">תבנית: {selectedTemplate?.name || announcement.templateName}</span>
              <span className="meta-chip">תאריך: {formatDate(announcement.announcementDate)}</span>
            </div>
          </div>
          <div className="student-actions student-actions-wrap">
            <Link className="btn btn-ghost" href="/announcements">חזרה להודעות</Link>
            <Link className="btn btn-primary" href={`/api/announcements/${announcement.id}/pdf`} target="_blank">פתח PDF A4</Link>
          </div>
        </div>
      </div>

      {created ? <div className="ok">המודעה נוצרה ונשמרה.</div> : null}
      {updated ? <div className="ok">המודעה עודכנה.</div> : null}
      {errorText ? <div className="card muted">{errorText}</div> : null}

      <div className="grid announcements-layout">
        <div className="card glass">
          <h3>עריכת המודעה</h3>
          <form action={updateAnnouncementAction} className="grid">
            <input type="hidden" name="announcementId" value={announcement.id} />
            <div>
              <label>תבנית</label>
              <select name="templateId" value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
                {templates.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label>כותרת לניהול</label>
              <input name="title" defaultValue={announcement.title} required />
            </div>
            <div>
              <label>תאריך</label>
              <input type="date" name="announcementDate" defaultValue={clean(announcement.announcementDate)} />
            </div>
            <div>
              <label>גוף הטקסט</label>
              <AnnouncementEditorClient
                namePrefix="body"
                initialText={announcement.bodyText}
                initialHtml={announcement.bodyHtml}
                onChange={setEditorState}
              />
            </div>
            <LayoutControlsClient initialLayout={announcement.layoutOverride} onChange={setLayout} />
            <button type="submit">שמור שינויים</button>
          </form>
        </div>

        <div className="card glass">
          <h3>תצוגה מקדימה חיה</h3>
          <div className="announcement-preview-shell">
            <AnnouncementSheet
              template={selectedTemplate}
              layout={layout}
              bodyText={editorState.text}
              bodyHtml={editorState.html}
            />
          </div>
        </div>
      </div>
    </>
  );
}
