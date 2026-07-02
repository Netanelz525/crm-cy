import Link from "next/link";
import { redirect } from "next/navigation";
import AnnouncementComposerClient from "../announcement-composer-client";
import { createAnnouncementAction } from "../actions";
import { listAnnouncementTemplates } from "../../../lib/announcements";
import { requireAuthenticatedUser } from "../../../lib/rbac";

function clean(value) {
  return String(value || "").trim();
}

export default async function NewAnnouncementPage({ searchParams }) {
  const user = await requireAuthenticatedUser();
  if (!user.is_team_member && !user.is_manager) {
    redirect("/unauthorized");
  }

  const resolvedSearchParams = await searchParams;
  const errorText = clean(resolvedSearchParams?.error);
  const templates = await listAnnouncementTemplates();

  return (
    <>
      <div className="card glass">
        <div className="announcement-breadcrumbs">
          <Link href="/announcements">הודעות</Link>
          <span>/</span>
          <span>הודעה חדשה</span>
        </div>
        <div className="student-topbar">
          <div>
            <h1>הודעה חדשה</h1>
            <p className="muted">כאן בוחרים תבנית, מכוונים את אזור הטקסט, ועורכים את המודעה על גבי התצוגה החיה.</p>
          </div>
          <div className="student-actions student-actions-wrap">
            <Link className="btn btn-ghost" href="/announcements">חזרה להודעות</Link>
          </div>
        </div>
      </div>

      {errorText ? <div className="card muted">{errorText}</div> : null}

      <div className="card glass">
        {!templates.length ? (
          <>
            <div className="muted">אין עדיין תבניות זמינות. שמור קודם תבנית אחת במסך ההודעות ואז חזור לכאן.</div>
            <div className="student-actions student-actions-wrap">
              <Link className="btn btn-primary" href="/announcements">חזרה למסך ההודעות</Link>
            </div>
          </>
        ) : (
          <AnnouncementComposerClient
            action={createAnnouncementAction}
            templates={templates}
            submitLabel="צור מודעה"
            flowTitle="מודעה חדשה"
            footerActions={<Link className="btn btn-ghost" href="/announcements">חזרה להודעות</Link>}
          />
        )}
      </div>
    </>
  );
}
