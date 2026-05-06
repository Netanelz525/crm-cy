import { notFound, redirect } from "next/navigation";
import { normalizeImportResult } from "../../../../../lib/excel-student-import";
import { getImportSession } from "../../../../../lib/import-sessions";
import { requireAuthenticatedUser } from "../../../../../lib/rbac";
import ImportProgressClient from "./progress-client";

function clean(value) {
  return String(value || "").trim();
}

export default async function NeonImportProgressPage({ params }) {
  const user = await requireAuthenticatedUser();
  if (!user.is_team_member && !user.is_manager) {
    redirect("/unauthorized");
  }

  const resolvedParams = await params;
  const sessionId = clean(resolvedParams?.sessionId);
  const session = await getImportSession(sessionId);
  if (!session || clean(session.created_by_user_id) !== clean(user.clerk_user_id)) {
    notFound();
  }

  const initialState = {
    status: clean(session.status) || "draft",
    progress: session.progress_json || {
      totalRows: Array.isArray(session.rows) ? session.rows.length : 0,
      processedRows: 0,
      updated: 0,
      skipped: 0,
      failed: 0
    },
    result: session.result_json ? normalizeImportResult(session.result_json) : null,
    error: clean(session.result_json?.error || "")
  };

  return <ImportProgressClient sessionId={sessionId} initialState={initialState} />;
}
