import { NextResponse } from "next/server";
import { buildImportReportWorkbook } from "../../../../../lib/excel-student-import";
import { getImportSession } from "../../../../../lib/import-sessions";
import { requireAuthenticatedUser } from "../../../../../lib/rbac";

function clean(value) {
  return String(value || "").trim();
}

function fileBaseName(fileName) {
  const raw = clean(fileName) || "import";
  return raw.replace(/\.[^.]+$/, "") || "import";
}

export async function GET(_request, { params }) {
  const user = await requireAuthenticatedUser();
  if (!user.is_team_member && !user.is_manager) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const resolvedParams = await params;
  const sessionId = clean(resolvedParams?.sessionId);
  const session = await getImportSession(sessionId);
  if (!session || clean(session.created_by_user_id) !== clean(user.clerk_user_id)) {
    return NextResponse.json({ error: "Import session not found" }, { status: 404 });
  }

  const result = session.result_json;
  if (!result?.rowResults?.length) {
    return NextResponse.json({ error: "No import report available for this session" }, { status: 404 });
  }

  const buffer = buildImportReportWorkbook({
    fileName: result.fileName || session.file_name,
    matchMapping: result.matchMapping || {},
    fieldMapping: result.fieldMapping || {},
    rowResults: result.rowResults || []
  });
  const filename = `${fileBaseName(result.fileName || session.file_name)}-import-report.xlsx`;

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
    }
  });
}
