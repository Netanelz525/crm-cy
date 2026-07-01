import { NextResponse } from "next/server";
import { authenticateApiToken, readBearerToken } from "../../../../../lib/api-tokens";
import { getPrintJobFileChunk } from "../../../../../lib/print-jobs";

function clean(value) {
  return String(value || "").trim();
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(request, { params }) {
  const token = readBearerToken(request);
  const auth = await authenticateApiToken(token, "print:read");
  if (!auth) return unauthorized();

  try {
    const resolvedParams = await params;
    const url = new URL(request.url);
    const chunk = await getPrintJobFileChunk(clean(resolvedParams?.jobId), {
      offset: url.searchParams.get("offset"),
      length: url.searchParams.get("length")
    });

    if (!chunk) {
      return NextResponse.json({ error: "Print job not found" }, { status: 404 });
    }

    return NextResponse.json({
      resource: "printJobFileChunk",
      item: chunk
    });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Print job file download failed" }, { status: 400 });
  }
}
