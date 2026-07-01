import { NextResponse } from "next/server";
import { authenticateApiToken, readBearerToken } from "../../../../lib/api-tokens";
import { claimNextPrintJob, sendPrintJobReceiptEmail } from "../../../../lib/print-jobs";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(request) {
  const token = readBearerToken(request);
  const auth = await authenticateApiToken(token, "print:read");
  if (!auth) return unauthorized();

  try {
    const job = await claimNextPrintJob({ claimedByTokenId: auth.id });
    if (!job) {
      return NextResponse.json({
        resource: "printJob",
        item: null
      });
    }

    const origin = new URL(request.url).origin;
    await sendPrintJobReceiptEmail(job.id);

    return NextResponse.json({
      resource: "printJob",
      item: {
        ...job,
        downloadUrl: `${origin}/api/print-jobs/${encodeURIComponent(job.id)}/file`
      }
    });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Print job lookup failed" }, { status: 500 });
  }
}
