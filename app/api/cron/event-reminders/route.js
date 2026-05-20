import { NextResponse } from "next/server";
import { assertCronAuthorized, runStudentEventReminderJob } from "../../../../lib/event-reminders";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request) {
  try {
    if (!assertCronAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const force = url.searchParams.get("force") === "1";
    const result = await runStudentEventReminderJob({ force });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Student event reminder cron failed:", error?.message || error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Student event reminder cron failed" },
      { status: 500 }
    );
  }
}
