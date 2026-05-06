import { NextResponse } from "next/server";
import { markEmailClicked } from "../../../../../lib/email-campaigns";

function safeRedirectUrl(value) {
  const raw = String(value || "").trim();
  try {
    const url = new URL(raw);
    if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
  } catch {
  }
  return "/";
}

export async function GET(request, { params }) {
  const resolvedParams = await params;
  const deliveryId = String(resolvedParams?.id || "").trim();
  if (deliveryId) {
    await markEmailClicked(deliveryId).catch(() => null);
  }

  const url = new URL(request.url);
  return NextResponse.redirect(safeRedirectUrl(url.searchParams.get("url")));
}
