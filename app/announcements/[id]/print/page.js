import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAnnouncementById, getAnnouncementTemplateById } from "../../../../lib/announcements";
import { requireAuthenticatedUser } from "../../../../lib/rbac";
import AnnouncementSheet from "../../announcement-sheet";
import AnnouncementPrintClient from "./print-client";

export default async function AnnouncementPrintPage({ params }) {
  const user = await requireAuthenticatedUser();
  if (!user.is_team_member && !user.is_manager) {
    redirect("/unauthorized");
  }

  const resolvedParams = await params;
  const announcement = await getAnnouncementById(resolvedParams.id);
  if (!announcement) notFound();

  const template = await getAnnouncementTemplateById(announcement.templateId);
  if (!template) notFound();

  return (
    <div className="announcement-print-page">
      <div className="announcement-print-toolbar">
        <div className="student-actions student-actions-wrap">
          <Link className="btn btn-ghost" href={`/announcements/${announcement.id}`}>חזרה למודעה</Link>
          <AnnouncementPrintClient />
        </div>
      </div>
      <div className="announcement-print-canvas">
        <AnnouncementSheet template={template} layout={announcement.layoutOverride} bodyText={announcement.bodyText} bodyHtml={announcement.bodyHtml} printMode />
      </div>
    </div>
  );
}
