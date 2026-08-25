import { NextResponse } from "next/server";
import { getCurrentAppUser } from "../../../../../lib/rbac";
import { deleteExternalMandate, listExternalMandates, upsertExternalMandate } from "../../../../../lib/external-mandates";

async function manager() {
  const user = await getCurrentAppUser();
  return user && (user.is_team_member || user.is_manager || user.is_super_admin) ? user : null;
}

export async function GET() {
  if (!await manager()) return NextResponse.json({ error: "אין הרשאה." }, { status: 403 });
  return NextResponse.json({ mandates: await listExternalMandates() });
}

export async function POST(request) {
  const user = await manager();
  if (!user) return NextResponse.json({ error: "אין הרשאה." }, { status: 403 });
  try {
    const body = await request.json();
    return NextResponse.json({ ok: true, mandate: await upsertExternalMandate({ ...body, userId: user.clerk_user_id }) });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "שמירת הוראת הקבע נכשלה." }, { status: 400 });
  }
}

export async function DELETE(request) {
  if (!await manager()) return NextResponse.json({ error: "אין הרשאה." }, { status: 403 });
  const body = await request.json();
  await deleteExternalMandate(body.id);
  return NextResponse.json({ ok: true });
}
