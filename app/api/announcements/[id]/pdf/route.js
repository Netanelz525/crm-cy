import { NextResponse } from "next/server";
import { canUseAnnouncementTemplate, getAnnouncementById, getAnnouncementTemplateById } from "../../../../../lib/announcements";
import { getCurrentAppUser } from "../../../../../lib/rbac";
import { renderAnnouncementDocx } from "../../../../../lib/announcement-pdf";
import { convertAnnouncementDocxToPdf } from "../../../../../lib/announcement-converter";

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
  // A DOCX template must never silently fall back to the legacy HTML renderer.
  // Returning a visible configuration error is safer than producing a PDF that
  // looks unrelated to the Word template.
  if (template.engine === "docx-template" && !template.docxObjectKey) {
    return NextResponse.json({ error: "תבנית Word מוגדרת ללא קובץ Word פעיל" }, { status: 409 });
  }

  try {
    const renderedDocx = await renderAnnouncementDocx({ announcement, template });
    const pdf = await convertAnnouncementDocxToPdf(
      renderedDocx,
      `${fileName(announcement.title) || "announcement"}.docx`
    );
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new NextResponse(pdf, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `${download ? "attachment" : "inline"}; filename="${fileName(announcement.title)}.pdf"`,
        "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        pragma: "no-cache",
        expires: "0",
        "x-announcement-pdf-source": template.docxObjectKey ? "docx" : "html",
        "x-announcement-pdf-renderer": "booklet-printer",
        "x-announcement-template-key": template.templateKey || template.id || ""
      }
    });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "PDF generation failed" }, { status: 500 });
  }
}
