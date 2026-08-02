import { NextResponse } from "next/server";
import { withTemporaryAnnouncementSignatureLinks } from "../../../../lib/announcement-signature-links";
import { authenticateApiToken, readBearerToken } from "../../../../lib/api-tokens";
import { claimNextPrintJob, claimNextPrintJobViaQueue, sendPrintJobReceiptEmail } from "../../../../lib/print-jobs";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(request) {
  const token = readBearerToken(request);
  const auth = await authenticateApiToken(token, "print:read");
  if (!auth) return unauthorized();

  try {
    let job = null;
    let usedQueue = false;

    try {
      const queueResult = await claimNextPrintJobViaQueue({ claimedByTokenId: auth.id });
      usedQueue = Boolean(queueResult?.configured);
      job = queueResult?.job || null;
    } catch (queueError) {
      console.error("Print queue lookup failed, falling back to database polling.", queueError);
    }

    if (!usedQueue) {
      job = await claimNextPrintJob({ claimedByTokenId: auth.id });
    }

    if (!job) {
      return NextResponse.json({
        resource: "printJob",
        item: null
      });
    }

    const origin = new URL(request.url).origin;
    const jobWithTemporaryLinks = await withTemporaryAnnouncementSignatureLinks(job, origin);
    await sendPrintJobReceiptEmail(job.id);

    return NextResponse.json({
      resource: "printJob",
      item: {
        ...jobWithTemporaryLinks,
        downloadUrl: `${origin}/api/print-jobs/${encodeURIComponent(job.id)}/file`,
        downloadRawUrl: `${origin}/api/print-jobs/${encodeURIComponent(job.id)}/file?raw=1`
      }
    });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Print job lookup failed" }, { status: 500 });
  }
}
