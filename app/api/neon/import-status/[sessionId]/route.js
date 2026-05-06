import { NextResponse } from "next/server";
import { getImportSession } from "../../../../../lib/import-sessions";
import { requireAuthenticatedUser } from "../../../../../lib/rbac";

function clean(value) {
  return String(value || "").trim();
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

  return NextResponse.json({
    status: clean(session.status) || "draft",
    progress: session.progress_json || {
      totalRows: Array.isArray(session.rows) ? session.rows.length : 0,
      processedRows: 0,
      updated: 0,
      skipped: 0,
      failed: 0
    },
    result: session.result_json || null,
    error: clean(session.result_json?.error || "")
  });
}
