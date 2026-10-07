import { NextResponse } from "next/server";
import { canUseAnnouncementTemplate, getAnnouncementById, getAnnouncementTemplateById } from "../../../../../lib/announcements";
import { renderDocxTemplate } from "../../../../../lib/docx-template";
import { getObjectBytesFromR2 } from "../../../../../lib/r2";
import { getCurrentAppUser } from "../../../../../lib/rbac";

export const runtime = "nodejs";

function clean(value) {
  return String(value || "").trim();
}

function fileName(value) {
  return clean(value)
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140) || "announcement";
}

function contentDisposition(filename) {
  const fallback = "announcement.docx";
  return "attachment; filename=\"" + fallback.replace(/"/g, "_") + "\"; filename*=UTF-8''" + encodeURIComponent(filename);
}

function templateData(announcement, template) {
  const fields = announcement?.templateFields && typeof announcement.templateFields === "object" ? announcement.templateFields : {};
  const data = { ...fields, title: fields.title || announcement.title, name: fields.name || announcement.title };
  for (const field of template?.fields || []) {
    const key = clean(field?.key);
    const templateFieldId = clean(field?.templateFieldId);
    if (!key || !templateFieldId) continue;

    // DOCX templates use their Word placeholder IDs (for example 1, 3, 4),
    // while the announcement stores values under semantic field keys.
    if (!(templateFieldId in data) && key in fields) data[templateFieldId] = fields[key];
    if (!(key in data) && templateFieldId in fields) data[key] = fields[templateFieldId];
  }
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === "object") data[key] = value.type === "image" ? "" : clean(value.value || value.text);
  }
  return data;
}

export async function GET(_request, { params }) {
  const user = await getCurrentAppUser();
  if (!user || !user.can_use_announcement_templates) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const resolvedParams = await params;
  const announcement = await getAnnouncementById(resolvedParams?.id);
  if (!announcement) return NextResponse.json({ error: "Announcement not found" }, { status: 404 });
  const template = await getAnnouncementTemplateById(announcement.templateId);
  if (!template || !canUseAnnouncementTemplate(user, template)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!template.docxObjectKey) return NextResponse.json({ error: "No Word template is attached" }, { status: 404 });

  try {
    const object = await getObjectBytesFromR2(template.docxObjectKey);
    const rendered = renderDocxTemplate(Buffer.from(object.bytes), templateData(announcement, template));
    return new NextResponse(rendered, {
      status: 200,
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "content-disposition": contentDisposition(fileName(announcement.title) + ".docx")
      }
    });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "DOCX generation failed" }, { status: 500 });
  }
}
