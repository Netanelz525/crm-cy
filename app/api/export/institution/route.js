import { NextResponse } from "next/server";
import { getCurrentAppUser } from "../../../../lib/rbac";
import { buildInstitutionCsvExport } from "../../../../lib/institution-exports";

export async function GET(request) {
  const user = await getCurrentAppUser();
  if (!user || (!user.is_team_member && !user.is_manager)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const url = new URL(request.url);
  const result = await buildInstitutionCsvExport(url.searchParams);

  return new NextResponse(result.content, {
    status: 200,
    headers: {
      "content-type": result.contentType,
      "content-disposition": `attachment; filename="${result.filename}"`
    }
  });
}
