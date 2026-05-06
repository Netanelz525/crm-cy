import { NextResponse } from "next/server";
import { getCurrentAppUser } from "../../../../lib/rbac";
import { getNeonPreferencesForUser, mergeSearchParamsWithNeonPreferences } from "../../../../lib/neon-preferences";

export async function GET(request) {
  const user = await getCurrentAppUser();
  if (!user || (!user.is_team_member && !user.is_manager)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const { buildInstitutionCsvExport } = await import("../../../../lib/institution-exports");
    const url = new URL(request.url);
    const preferences = await getNeonPreferencesForUser(user.clerk_user_id);
    const mergedSearchParams = mergeSearchParamsWithNeonPreferences(url.searchParams, preferences?.query_string || "");
    const result = await buildInstitutionCsvExport(mergedSearchParams);

    return new NextResponse(result.content, {
      status: 200,
      headers: {
        "content-type": result.contentType,
        "content-disposition": "attachment; filename=\"export.xlsx\""
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Export failed" },
      { status: 500 }
    );
  }
}
