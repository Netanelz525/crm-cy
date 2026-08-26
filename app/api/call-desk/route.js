import { NextResponse } from "next/server";
import { getCurrentAppUser } from "../../../lib/rbac";
import { createStudentContactLog } from "../../../lib/student-contact-logs";
import { assignStudentCall, completeStudentCall } from "../../../lib/student-call-assignments";

export async function POST(request) {
  const user = await getCurrentAppUser();
  if (!user) return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
  try {
    const body = await request.json();
    if (body.kind === "assign") {
      if (!user.is_manager && !user.is_super_admin) return NextResponse.json({ error: "אין הרשאה להקצות" }, { status: 403 });
      return NextResponse.json({ ok: true, assignment: await assignStudentCall({ studentId: body.studentId, assigneeUserId: body.assigneeUserId, assignedByUserId: user.clerk_user_id }) });
    }
    const contact = await createStudentContactLog({ studentId: body.studentId, contactDate: body.contactDate, noteText: body.noteText, createdByUserId: user.clerk_user_id });
    if (body.completed) await completeStudentCall({ studentId: body.studentId, userId: user.clerk_user_id });
    return NextResponse.json({ ok: true, contact });
  } catch (error) { return NextResponse.json({ error: error.message }, { status: 400 }); }
}
