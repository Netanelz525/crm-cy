import { notFound, redirect } from "next/navigation";
import { getAnnouncementById, getAnnouncementTemplateById, listAnnouncementTemplates } from "../../../lib/announcements";
import { requireAuthenticatedUser } from "../../../lib/rbac";
import AnnouncementEditClient from "../announcement-edit-client";

function clean(value) {
  return String(value || "").trim();
}

export default async function AnnouncementPage({ params, searchParams }) {
  const user = await requireAuthenticatedUser();
  if (!user.is_team_member && !user.is_manager) {
    redirect("/unauthorized");
  }

  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const announcement = await getAnnouncementById(resolvedParams.id);
  if (!announcement) notFound();

  const [template, templates] = await Promise.all([
    getAnnouncementTemplateById(announcement.templateId),
    listAnnouncementTemplates()
  ]);

  return (
    <AnnouncementEditClient
      announcement={announcement}
      templates={templates}
      initialTemplate={template}
      created={clean(resolvedSearchParams?.created) === "1"}
      updated={clean(resolvedSearchParams?.updated) === "1"}
      errorText={clean(resolvedSearchParams?.error)}
    />
  );
}
