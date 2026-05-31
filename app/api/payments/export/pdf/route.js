import { NextResponse } from "next/server";
import { buildPaymentReportPdfExport } from "../../../../../lib/payment-report-exports";
import { getCurrentAppUser } from "../../../../../lib/rbac";

function asciiFallbackFilename(filename, fallback = "payment-report.pdf") {
  const cleaned = String(filename || "")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/["\\]/g, "")
    .trim();
  return cleaned || fallback;
}

export async function GET(request) {
  const user = await getCurrentAppUser();
  if (!user || (!user.is_team_member && !user.is_manager && !user.is_super_admin)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const url = new URL(request.url);
    const result = await buildPaymentReportPdfExport(url.searchParams);
    return new NextResponse(result.content, {
      status: 200,
      headers: {
        "content-type": result.contentType,
        "content-disposition": `attachment; filename="${asciiFallbackFilename(result.filename)}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Payment report PDF export failed" },
      { status: 500 }
    );
  }
}
