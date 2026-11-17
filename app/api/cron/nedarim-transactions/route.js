import { NextResponse } from "next/server";
import { assertPaymentLinkingCronAuthorized } from "../../../../lib/monthly-payment-student-linking.js";
import { syncNedarimTransactionArchive } from "../../../../lib/payment-systems.js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request) {
  try {
    if (!assertPaymentLinkingCronAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const result = await syncNedarimTransactionArchive();
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch {
    return NextResponse.json({ ok: false, error: "Nedarim transaction sync failed" }, { status: 500 });
  }
}
