import { NextResponse } from "next/server";
import { authenticateApiToken, readBearerToken } from "../../../../../lib/api-tokens";
import { getPrintJobFile, getPrintJobFileChunk } from "../../../../../lib/print-jobs";

function clean(value) {
  return String(value || "").trim();
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function safeFileName(value) {
  return clean(value).replace(/[^\p{L}\p{N}._ -]+/gu, "_") || "print-job";
}

export async function GET(request, { params }) {
  const token = readBearerToken(request);
  const auth = await authenticateApiToken(token, "print:read");
  if (!auth) return unauthorized();

  try {
    const resolvedParams = await params;
    const url = new URL(request.url);
    const jobId = clean(resolvedParams?.jobId);
    const wantsRawFile = clean(url.searchParams.get("raw")) === "1"
      || clean(request.headers.get("accept")).includes("application/octet-stream");

    if (wantsRawFile) {
      const file = await getPrintJobFile(jobId, { claimedByTokenId: auth.id });

      if (!file) {
        return NextResponse.json({ error: "Print job not found" }, { status: 404 });
      }

      if (!file.fileBase64) {
        return NextResponse.json({ error: "Print job file is no longer available" }, { status: 410 });
      }

      const bytes = Buffer.from(file.fileBase64, "base64");
      const fileName = safeFileName(file.fileName);

      return new NextResponse(bytes, {
        headers: {
          "content-type": file.contentType,
          "content-length": String(bytes.length),
          "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
          "x-print-job-id": file.id,
          "x-print-file-base64-length": String(file.totalLength)
        }
      });
    }

    const chunk = await getPrintJobFileChunk(jobId, {
      offset: url.searchParams.get("offset"),
      length: url.searchParams.get("length"),
      claimedByTokenId: auth.id
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
