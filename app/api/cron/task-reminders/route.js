import { NextResponse } from "next/server";
import { assertTaskReminderCronAuthorized, runTaskReminderJob } from "../../../../lib/task-reminders";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request) {
  try {
    if (!assertTaskReminderCronAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const force = url.searchParams.get("force") === "1";
    const reminderDate = url.searchParams.get("date") || "";
    const result = await runTaskReminderJob({ force, reminderDate });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Task reminder cron failed:", error?.message || error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Task reminder cron failed" },
      { status: 500 }
    );
  }
}
