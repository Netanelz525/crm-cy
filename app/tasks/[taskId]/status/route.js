import { NextResponse } from "next/server";
import { requireAttendanceUser } from "../../../../lib/rbac";
import { TASK_STATUS_OPTIONS, updateTaskStatus } from "../../../../lib/tasks";

function clean(value) {
  return String(value || "").trim();
}

function safeRedirect(path, fallback) {
  const target = clean(path);
  if (!target || !target.startsWith("/") || target.startsWith("//")) return fallback;
  return target;
}

export async function GET(request, { params }) {
  await requireAttendanceUser();
  const { taskId } = await params;
  const url = new URL(request.url);
  const status = clean(url.searchParams.get("status"));
  const allowed = TASK_STATUS_OPTIONS.some((option) => option.value === status);
  const returnTo = safeRedirect(url.searchParams.get("returnTo"), `/tasks?taskId=${encodeURIComponent(clean(taskId))}`);

  if (allowed) {
    await updateTaskStatus(taskId, status);
  }

  const separator = returnTo.includes("?") ? "&" : "?";
  const nextUrl = new URL(`${returnTo}${separator}${allowed ? "taskUpdated=1" : "error=סטטוס לא תקין"}`, request.url);
  return NextResponse.redirect(nextUrl);
}
