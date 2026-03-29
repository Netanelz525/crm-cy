import Link from "next/link";
import { redirect } from "next/navigation";
import AnnouncementComposerClient from "../announcement-composer-client";
import { createAnnouncementAction } from "../actions";
import { listAnnouncementTemplates } from "../../../lib/announcements";
import { requireAuthenticatedUser } from "../../../lib/rbac";

export default async function NewAnnouncementPage() {
  const user = await requireAuthenticatedUser();
  if (!user.is_team_member && !user.is_manager) {
    redirect("/unauthorized");
  }

  const templates = await listAnnouncementTemplates();

  return (
    <>
      <div className="card glass">
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
          />
        )}
      </div>
    </>
  );
}
