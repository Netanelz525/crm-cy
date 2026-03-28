import { NextResponse } from "next/server";
import { getAnnouncementTemplateById } from "../../../../../../lib/announcements";
import { getCurrentAppUser } from "../../../../../../lib/rbac";
import { getObjectBytesFromR2 } from "../../../../../../lib/r2";

export async function GET(_request, { params }) {
  const user = await getCurrentAppUser();
  if (!user || (!user.is_team_member && !user.is_manager)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resolvedParams = await params;
  const template = await getAnnouncementTemplateById(resolvedParams?.id);
  if (!template?.blankObjectKey) {
    return NextResponse.json({ error: "Template blank not found" }, { status: 404 });
  }

  try {
    const object = await getObjectBytesFromR2(template.blankObjectKey);
    return new NextResponse(object.bytes, {
      status: 200,
      headers: {
        "content-type": template.blankContentType || object.contentType || "application/octet-stream",
        "cache-control": "private, max-age=300"
      }
    });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Template blank read failed" }, { status: 500 });
  }
}
