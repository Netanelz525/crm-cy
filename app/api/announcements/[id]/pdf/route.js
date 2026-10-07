import { NextResponse } from "next/server";
import { canUseAnnouncementTemplate, getAnnouncementById, getAnnouncementTemplateById } from "../../../../../lib/announcements";
import { getCurrentAppUser } from "../../../../../lib/rbac";
import { renderAnnouncementPdf } from "../../../../../lib/announcement-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function clean(value) {
  return String(value || "").trim();
}

function fileName(value) {
  return clean(value)
    .replace(/[^A-Za-z0-9\-_ ]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80) || "announcement";
}

export async function GET(request, { params }) {
  const user = await getCurrentAppUser();
  if (!user || !user.can_use_announcement_templates) {
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
  if (!canUseAnnouncementTemplate(user, template)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const searchParams = new URL(request.url).searchParams;
    const engine = searchParams.get("engine") === "officetopdf" ? "officetopdf" : "preview";
    const pdf = await renderAnnouncementPdf({ announcement, template, engine });
    const download = searchParams.get("download") === "1";
    return new NextResponse(pdf, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `${download ? "attachment" : "inline"}; filename="${fileName(announcement.title)}.pdf"`,
        "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        pragma: "no-cache",
        expires: "0"
      }
    });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "PDF generation failed" }, { status: 500 });
  }
}
