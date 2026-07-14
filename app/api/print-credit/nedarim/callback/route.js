import { NextResponse } from "next/server";
import {
  approvePrintCreditPurchaseFromNedarim,
  isAllowedNedarimCallbackIp
} from "../../../../../lib/print-credit-payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clean(value) {
  return String(value || "").trim();
}

function requesterIp(request) {
  const forwarded = clean(request.headers.get("x-forwarded-for")).split(",").map(clean).filter(Boolean)[0];
  return forwarded || clean(request.headers.get("x-real-ip"));
}

export async function POST(request) {
  const ip = requesterIp(request);
  if (process.env.NEDARIM_ALLOW_UNVERIFIED_CALLBACK !== "1" && !isAllowedNedarimCallbackIp(ip)) {
    return NextResponse.json({ ok: false, error: "מקור callback לא מאושר." }, { status: 403 });
  }

  try {
    const payload = await request.json();
    const result = await approvePrintCreditPurchaseFromNedarim(payload);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: clean(error?.message) || "קליטת התשלום נכשלה." }, { status: 400 });
  }
}
