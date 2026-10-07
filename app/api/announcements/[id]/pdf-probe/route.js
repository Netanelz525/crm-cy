import { NextResponse } from "next/server";
import { canUseAnnouncementTemplate, getAnnouncementById, getAnnouncementTemplateById } from "../../../../../lib/announcements";
import { getCurrentAppUser } from "../../../../../lib/rbac";
import { renderAnnouncementPdf } from "../../../../../lib/announcement-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request, { params }) {
  const user = await getCurrentAppUser();
  if (!user || !user.can_use_announcement_templates) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const announcement = await getAnnouncementById((await params)?.id);
  if (!announcement) return NextResponse.json({ error: "Announcement not found" }, { status: 404 });
  const template = await getAnnouncementTemplateById(announcement.templateId);
  if (!template || !canUseAnnouncementTemplate(user, template)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const pdf = await renderAnnouncementPdf({ announcement, template, engine: "officetopdf" });
    const pdfText = Buffer.from(pdf).toString("latin1");
    return NextResponse.json({
      ok: true,
      engine: "officetopdf",
      bytes: pdf.byteLength,
      header: pdfText.slice(0, 8),
      pageCount: (pdfText.match(/\/Type\s*\/Page(?!s)/g) || []).length
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error?.message || "PDF generation failed" }, { status: 500 });
  }
}
