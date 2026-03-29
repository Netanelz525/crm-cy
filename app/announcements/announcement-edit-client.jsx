"use client";

import Link from "next/link";
import AnnouncementComposerClient from "./announcement-composer-client";
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
  return (
    <>
      <div className="card glass">
        <div className="student-topbar">
          <div>
            <h1>מודעה</h1>
            <div className="student-meta-line">
              <span className="meta-chip">תבנית: {initialTemplate?.name || announcement.templateName}</span>
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
          <AnnouncementComposerClient
            action={updateAnnouncementAction}
            templates={templates}
            initialAnnouncement={announcement}
            submitLabel="שמור שינויים"
          />
        </div>
      </div>
    </>
  );
}
