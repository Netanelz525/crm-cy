import { NextResponse } from "next/server";
import { getCurrentAppUser } from "../../../../lib/rbac";
import { getPaymentDashboard, getPaymentMandatesDashboard, listPaymentConnections } from "../../../../lib/payment-systems";
import { deletePaymentRecordLink, upsertPaymentRecordLink } from "../../../../lib/payment-links";
import { upsertAndLinkPaymentRecord } from "../../../../lib/payment-student-links";

function clean(value) { return String(value || "").trim(); }

async function requirePaymentManager() {
  const user = await getCurrentAppUser();
  if (!user || (!user.is_team_member && !user.is_manager && !user.is_super_admin)) return null;
  return user;
}

export async function GET(request) {
  if (!await requirePaymentManager()) return NextResponse.json({ error: "אין הרשאה." }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const connections = await listPaymentConnections({ activeOnly: true });
  const connectionIds = connections.map((item) => item.id);
  const [transactions, mandates] = await Promise.all([
    getPaymentDashboard({ connectionIds, dateFrom: clean(params.get("dateFrom")), dateTo: clean(params.get("dateTo")) }),
    getPaymentMandatesDashboard({ connectionIds })
  ]);
  return NextResponse.json({ transactions: transactions.transactions || [], mandates: mandates.mandates || [] });
}

export async function POST(request) {
  const user = await requirePaymentManager();
  if (!user) return NextResponse.json({ error: "אין הרשאה." }, { status: 403 });
  try {
    const body = await request.json();
    const save = (item, recordType) => upsertPaymentRecordLink({
      recordType,
      provider: item.provider,
      connectionId: item.connectionId,
      externalRecordId: item.externalRecordId,
      studentId: body.studentId,
      payerType: body.payerType,
      payerName: body.payerName,
      payerEmail: body.payerEmail,
      payerPhone: body.payerPhone,
      notes: body.notes,
      recordSnapshot: item.recordSnapshot,
      linkedByUserId: user.clerk_user_id
    });
    const records = [await save(body.record, body.recordType)];
    await upsertAndLinkPaymentRecord({ item: { ...body.record.recordSnapshot, ...body.record }, recordType: body.recordType, studentId: body.studentId, userId: user.clerk_user_id });
    if (body.relatedMandate) {
      records.push(await save(body.relatedMandate, "mandate"));
      await upsertAndLinkPaymentRecord({ item: { ...body.relatedMandate.recordSnapshot, ...body.relatedMandate }, recordType: "mandate", studentId: body.studentId, userId: user.clerk_user_id });
    }
    return NextResponse.json({ ok: true, links: records });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "שמירת השיוך נכשלה." }, { status: 400 });
  }
}

export async function DELETE(request) {
  if (!await requirePaymentManager()) return NextResponse.json({ error: "אין הרשאה." }, { status: 403 });
  try {
    const body = await request.json();
    await deletePaymentRecordLink({ id: body.id });
    return NextResponse.json({ ok: true, id: body.id });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "הסרת השיוך נכשלה." }, { status: 400 });
  }
}
