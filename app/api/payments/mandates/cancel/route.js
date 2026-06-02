import { NextResponse } from "next/server";
import { cancelPaymentMandate } from "../../../../../lib/payment-systems";
import { getCurrentAppUser } from "../../../../../lib/rbac";

function clean(value) {
  return String(value || "").trim();
}

export async function POST(request) {
  const user = await getCurrentAppUser();
  if (!user || (!user.is_team_member && !user.is_manager && !user.is_super_admin)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const connectionId = clean(body?.connectionId);
    const mandateId = clean(body?.mandateId);
    if (!connectionId || !mandateId) {
      return NextResponse.json({ error: "Missing connectionId or mandateId" }, { status: 400 });
    }

    const result = await cancelPaymentMandate({ connectionId, mandateId });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: clean(error?.message) || "מחיקת הוראת הקבע נכשלה." },
      { status: 500 }
    );
  }
}
