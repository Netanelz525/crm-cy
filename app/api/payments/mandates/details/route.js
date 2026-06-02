import { NextResponse } from "next/server";
import { getPaymentMandateDetails } from "../../../../../lib/payment-systems";
import { getCurrentAppUser } from "../../../../../lib/rbac";

function clean(value) {
  return String(value || "").trim();
}

export async function GET(request) {
  const user = await getCurrentAppUser();
  if (!user || (!user.is_team_member && !user.is_manager && !user.is_super_admin)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const url = new URL(request.url);
    const connectionId = clean(url.searchParams.get("connectionId"));
    const mandateId = clean(url.searchParams.get("mandateId"));
    if (!connectionId || !mandateId) {
      return NextResponse.json({ error: "Missing connectionId or mandateId" }, { status: 400 });
    }

    const details = await getPaymentMandateDetails({ connectionId, mandateId });
    return NextResponse.json({ details });
  } catch (error) {
    return NextResponse.json(
      { error: clean(error?.message) || "טעינת פרטי הוראת הקבע נכשלה." },
      { status: 500 }
    );
  }
}
