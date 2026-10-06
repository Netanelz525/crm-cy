import { NextResponse } from "next/server";
import {
  assertMonthlyEmailErrorCronAuthorized,
  runMonthlyEmailErrorReportJob
} from "../../../../lib/monthly-email-error-report.js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request) {
  try {
    if (!assertMonthlyEmailErrorCronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const url = new URL(request.url);
    return NextResponse.json(await runMonthlyEmailErrorReportJob({ force: url.searchParams.get("force") === "1", jobKey: url.searchParams.get("jobKey") || "" }));
  } catch (error) {
    console.error("Monthly email error report cron failed:", error?.message || error);
    return NextResponse.json({ ok: false, error: error?.message || "Monthly email error report failed" }, { status: 500 });
  }
}
