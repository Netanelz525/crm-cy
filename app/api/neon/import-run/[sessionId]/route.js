import { NextResponse } from "next/server";
import { importStudentsFromRowsWithMapping, normalizeImportResult } from "../../../../../lib/excel-student-import";
import {
  getImportSession,
  markImportSessionFailed,
  markImportSessionRunning,
  updateImportSessionProgress,
  updateImportSessionResult
} from "../../../../../lib/import-sessions";
import { requireAuthenticatedUser } from "../../../../../lib/rbac";

function clean(value) {
  return String(value || "").trim();
}

export async function POST(_request, { params }) {
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

  if (clean(session.status) === "running") {
    return NextResponse.json({ ok: true, status: "running" });
  }
  if (clean(session.status) === "completed") {
    return NextResponse.json({ ok: true, status: "completed" });
  }

  const initialProgress = {
    totalRows: Array.isArray(session.rows) ? session.rows.length : 0,
    processedRows: 0,
    updated: 0,
    skipped: 0,
    failed: 0
  };

  await markImportSessionRunning(sessionId, initialProgress);

  try {
    const result = await importStudentsFromRowsWithMapping(session.rows, {
      matchMapping: session.match_mapping_json || {},
      fieldMapping: session.field_mapping_json || {},
      onProgress: async (progress) => {
        await updateImportSessionProgress(sessionId, progress);
      }
    });

    await updateImportSessionResult(sessionId, normalizeImportResult({
      fileName: session.file_name,
      matchMapping: session.match_mapping_json || {},
      fieldMapping: session.field_mapping_json || {},
      ...result
    }));

    return NextResponse.json({ ok: true, status: "completed" });
  } catch (error) {
    await markImportSessionFailed(sessionId, error?.message || "ייבוא נכשל");
    return NextResponse.json({ ok: false, status: "failed" }, { status: 500 });
  }
}
