import { NextResponse } from "next/server";
import { getAnnouncementById, getAnnouncementTemplateById } from "../../../../../lib/announcements";
import { getCurrentAppUser } from "../../../../../lib/rbac";
import { renderAnnouncementPdf } from "../../../../../lib/announcement-pdf";

export const runtime = "nodejs";

function clean(value) {
  return String(value || "").trim();
}

function fileName(value) {
  return clean(value)
    .replace(/[^\p{L}\p{N}\-_ ]/gu, "")
    .replace(/\s+/g, "-")
    .slice(0, 80) || "announcement";
}

export async function GET(_request, { params }) {
  const user = await getCurrentAppUser();
  if (!user || (!user.is_team_member && !user.is_manager)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resolvedParams = await params;
  const announcement = await getAnnouncementById(resolvedParams?.id);
  if (!announcement) {
    return NextResponse.json({ error: "Announcement not found" }, { status: 404 });
  }

  const template = await getAnnouncementTemplateById(announcement.templateId);
  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  try {
    const pdf = await renderAnnouncementPdf({ announcement, template });
    return new NextResponse(pdf, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${fileName(announcement.title)}.pdf"`
      }
    });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "PDF generation failed" }, { status: 500 });
  }
}
