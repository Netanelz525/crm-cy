import { NextResponse } from "next/server";
import { markEmailOpened } from "../../../../../lib/email-campaigns";

const PIXEL = Buffer.from("R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==", "base64");

export async function GET(_request, { params }) {
  const resolvedParams = await params;
  const rawId = String(resolvedParams?.id || "").replace(/\.gif$/i, "");
  if (rawId) {
    await markEmailOpened(rawId).catch(() => null);
  }

  return new NextResponse(PIXEL, {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, max-age=0"
    }
  });
}
