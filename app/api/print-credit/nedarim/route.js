import { NextResponse } from "next/server";
import { canAccessPrintFeature } from "../../../../lib/print-jobs";
import { createPrintCreditPurchaseIntent } from "../../../../lib/print-credit-payments";
import { requireAuthenticatedUser } from "../../../../lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clean(value) {
  return String(value || "").trim();
}

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

function callbackUrl(request) {
  const configured = clean(process.env.CRM_BASE_URL || process.env.APP_BASE_URL);
  const origin = configured || request.nextUrl.origin;
  return `${origin.replace(/\/$/, "")}/api/print-credit/nedarim/callback`;
}

export async function POST(request) {
  const user = await requireAuthenticatedUser();
  if (!canAccessPrintFeature(user)) return json({ error: "אין הרשאה לרכישת חבילת הדפסה." }, 403);

  try {
    const body = await request.json().catch(() => ({}));
    const result = await createPrintCreditPurchaseIntent({
      user,
      packageKey: body?.packageKey,
      callbackUrl: callbackUrl(request)
    });
    return json({ ok: true, ...result });
  } catch (error) {
    return json({ error: clean(error?.message) || "יצירת התשלום נכשלה." }, 400);
  }
}
