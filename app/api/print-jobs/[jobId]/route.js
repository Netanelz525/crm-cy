import { NextResponse } from "next/server";
import { authenticateApiToken, readBearerToken } from "../../../../lib/api-tokens";
import { claimPrintJobById, completePrintJob, sendPrintJobReceiptEmail } from "../../../../lib/print-jobs";

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
    const jobId = clean(resolvedParams?.jobId);
    const job = await claimPrintJobById(jobId, { claimedByTokenId: auth.id });
    if (!job) {
      return NextResponse.json({ error: "Print job not found or already handled" }, { status: 404 });
    }

    const origin = new URL(request.url).origin;
    await sendPrintJobReceiptEmail(job.id);

    return NextResponse.json({
      resource: "printJob",
      item: {
        ...job,
        downloadUrl: `${origin}/api/print-jobs/${encodeURIComponent(job.id)}/file`,
        downloadRawUrl: `${origin}/api/print-jobs/${encodeURIComponent(job.id)}/file?raw=1`
      }
    });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Print job lookup failed" }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  const token = readBearerToken(request);
  const auth = await authenticateApiToken(token, "print:delete");
  if (!auth) return unauthorized();

  try {
    const resolvedParams = await params;
    const jobId = clean(resolvedParams?.jobId);
    const body = await request.json().catch(() => null);
    await completePrintJob(jobId, {
      printedPageCount: body?.printedPageCount || body?.pageCount
    });

    return NextResponse.json({
      resource: "printJob",
      completed: true,
      id: jobId
    });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Print job delete failed" }, { status: 400 });
  }
}
