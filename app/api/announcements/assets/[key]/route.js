import { NextResponse } from "next/server";
import { getObjectBytesFromR2 } from "../../../../../lib/r2";

function clean(value) {
  return String(value || "").trim();
}

function decodeAssetKey(value) {
  const raw = clean(value);
  if (!raw) return "";
  try {
    return Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

export async function GET(_request, { params }) {
  const resolvedParams = await params;
  const objectKey = decodeAssetKey(resolvedParams?.key);
  if (!objectKey || !objectKey.startsWith("announcement-assets/")) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  try {
    const object = await getObjectBytesFromR2(objectKey);
    return new NextResponse(object.bytes, {
      status: 200,
      headers: {
        "content-type": object.contentType || "application/octet-stream",
        "cache-control": "public, max-age=86400"
      }
    });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Asset read failed" }, { status: 404 });
  }
}
