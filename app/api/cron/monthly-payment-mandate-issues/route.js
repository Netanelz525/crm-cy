import { NextResponse } from "next/server";
import {
  assertMonthlyPaymentMandateCronAuthorized,
  runMonthlyPaymentMandateIssuesReportJob
} from "../../../../lib/monthly-payment-mandate-report.js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request) {
  try {
    if (!assertMonthlyPaymentMandateCronAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const force = url.searchParams.get("force") === "1";
    const jobKey = url.searchParams.get("jobKey") || "";
    const result = await runMonthlyPaymentMandateIssuesReportJob({ force, jobKey });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Monthly payment mandate issues cron failed:", error?.message || error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Monthly payment mandate issues cron failed" },
      { status: 500 }
    );
  }
}
