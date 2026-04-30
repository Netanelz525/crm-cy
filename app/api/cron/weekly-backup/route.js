import { NextResponse } from "next/server";
import { assertCronAuthorized, runWeeklyBackupJob } from "../../../../lib/weekly-backup";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request) {
  try {
    if (!assertCronAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const force = url.searchParams.get("force") === "1";
    const result = await runWeeklyBackupJob({ force });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Weekly backup cron failed:", error?.message || error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Weekly backup cron failed" },
      { status: 500 }
    );
  }
}
