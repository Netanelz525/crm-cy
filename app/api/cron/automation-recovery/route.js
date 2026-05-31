import { NextResponse } from "next/server";
import { assertCronAuthorized, runAutomationRecoveryJob } from "../../../../lib/automation-recovery.js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request) {
  try {
    if (!assertCronAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await runAutomationRecoveryJob();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Automation recovery cron failed:", error?.message || error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Automation recovery cron failed" },
      { status: 500 }
    );
  }
}
