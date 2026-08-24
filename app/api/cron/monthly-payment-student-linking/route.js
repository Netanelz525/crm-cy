import { NextResponse } from "next/server";
import { assertPaymentLinkingCronAuthorized, runMonthlyPaymentStudentLinking } from "../../../../lib/monthly-payment-student-linking.js";
import { previousPaymentMonth } from "../../../../lib/payment-student-links.js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request) {
  try {
    if (!assertPaymentLinkingCronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const url = new URL(request.url);
    const periodMonth = url.searchParams.get("month") || previousPaymentMonth();
    const result = await runMonthlyPaymentStudentLinking({ periodMonth, force: url.searchParams.get("force") === "1" });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Monthly payment student linking failed:", error?.message || error);
    return NextResponse.json({ ok: false, error: error?.message || "Payment linking failed" }, { status: 500 });
  }
}
