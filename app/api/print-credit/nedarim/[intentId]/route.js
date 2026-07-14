import { NextResponse } from "next/server";
import { getPrintCreditPurchaseIntent } from "../../../../../lib/print-credit-payments";
import { requireAuthenticatedUser } from "../../../../../lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clean(value) {
  return String(value || "").trim();
}

export async function GET(_request, { params }) {
  const user = await requireAuthenticatedUser();
  const resolvedParams = await params;
  const intent = await getPrintCreditPurchaseIntent(clean(resolvedParams?.intentId), user.clerk_user_id);
  if (!intent) {
    return NextResponse.json({ ok: false, error: "רכישת הקרדיט לא נמצאה." }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    intent: {
      id: intent.id,
      packageKey: intent.packageKey,
      pages: intent.pages,
      amountAgorot: intent.amountAgorot,
      status: intent.status,
      approvedAt: intent.approvedAt
    }
  });
}
