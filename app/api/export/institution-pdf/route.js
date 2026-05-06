import { NextResponse } from "next/server";
import { getCurrentAppUser } from "../../../../lib/rbac";
import { getNeonPreferencesForUser, mergeSearchParamsWithNeonPreferences } from "../../../../lib/neon-preferences";

function asciiFallbackFilename(filename, fallback = "export.pdf") {
  const cleaned = String(filename || "")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/["\\]/g, "")
    .trim();
  return cleaned || fallback;
}

export async function GET(request) {
  const user = await getCurrentAppUser();
  if (!user || (!user.is_team_member && !user.is_manager)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const { buildInstitutionPdfExport } = await import("../../../../lib/institution-exports");
    const url = new URL(request.url);
    const preferences = await getNeonPreferencesForUser(user.clerk_user_id);
    const mergedSearchParams = mergeSearchParamsWithNeonPreferences(url.searchParams, preferences?.query_string || "");
    const result = await buildInstitutionPdfExport(mergedSearchParams);

    return new NextResponse(result.content, {
      status: 200,
      headers: {
        "content-type": result.contentType,
        "content-disposition": `attachment; filename="${asciiFallbackFilename(result.filename, "export.pdf")}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "PDF export failed" },
      { status: 500 }
    );
  }
}
