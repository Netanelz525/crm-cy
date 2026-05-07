import { NextResponse } from "next/server";
import { buildAttendancePdfExport } from "../../../../../lib/attendance-exports";
import { getCurrentAppUser } from "../../../../../lib/rbac";

function asciiFallbackFilename(filename, fallback = "attendance-report.pdf") {
  const cleaned = String(filename || "")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/["\\]/g, "")
    .trim();
  return cleaned || fallback;
}

export async function GET(_request, { params }) {
  const user = await getCurrentAppUser();
  if (!user || (!user.is_team_member && !user.is_manager)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const resolvedParams = await params;
    const result = await buildAttendancePdfExport(resolvedParams.sessionId);

    return new NextResponse(result.content, {
      status: 200,
      headers: {
        "content-type": result.contentType,
        "content-disposition": `attachment; filename="${asciiFallbackFilename(result.filename)}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Attendance PDF export failed" },
      { status: 500 }
    );
  }
}
