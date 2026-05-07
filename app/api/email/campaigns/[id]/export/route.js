import { NextResponse } from "next/server";
import { getCurrentAppUser } from "../../../../../../lib/rbac";
import { buildEmailCampaignExport } from "../../../../../../lib/email-campaigns";

function clean(value) {
  return String(value || "").trim();
}

export async function GET(_request, { params }) {
  const user = await getCurrentAppUser();
  if (!user || !user.can_view_email_reports) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const resolvedParams = await params;
    const result = await buildEmailCampaignExport(clean(resolvedParams?.id));
    return new NextResponse(result.content, {
      status: 200,
      headers: {
        "content-type": result.contentType,
        "content-disposition": `attachment; filename="${result.filename}"`
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Export failed" },
      { status: 500 }
    );
  }
}
