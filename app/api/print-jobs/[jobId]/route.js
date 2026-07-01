import { NextResponse } from "next/server";
import { authenticateApiToken, readBearerToken } from "../../../../lib/api-tokens";
import { deletePrintJob } from "../../../../lib/print-jobs";

function clean(value) {
  return String(value || "").trim();
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function DELETE(request, { params }) {
  const token = readBearerToken(request);
  const auth = await authenticateApiToken(token, "print:delete");
  if (!auth) return unauthorized();

  try {
    const resolvedParams = await params;
    const jobId = clean(resolvedParams?.jobId);
    await deletePrintJob(jobId);

    return NextResponse.json({
      resource: "printJob",
      deleted: true,
      id: jobId
    });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Print job delete failed" }, { status: 400 });
  }
}
