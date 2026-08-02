import { NextResponse } from "next/server";
import { getAnnouncementSignatureByAccessToken } from "../../../../../lib/announcement-signature-links";

function clean(value) {
  return String(value || "").trim();
}

export async function GET(_request, { params }) {
  const resolvedParams = await params;
  const token = clean(resolvedParams?.token);
  if (!token) {
    return NextResponse.json({ error: "Signature link not found" }, { status: 404 });
  }

  try {
    const signature = await getAnnouncementSignatureByAccessToken(token);
    if (!signature) {
      return NextResponse.json({ error: "Signature link expired" }, { status: 404 });
    }

    return new NextResponse(signature.bytes, {
      status: 200,
      headers: {
        "content-type": signature.contentType || "application/octet-stream",
        "cache-control": "private, no-store"
      }
    });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Signature read failed" }, { status: 404 });
  }
}
