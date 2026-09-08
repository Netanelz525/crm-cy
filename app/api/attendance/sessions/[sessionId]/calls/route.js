import { NextResponse } from "next/server";
import { getCurrentAppUser } from "../../../../../../lib/rbac";
import { CallQueueError, claimAttendanceCall, finishAttendanceCall, saveCallTeam } from "../../../../../../lib/attendance-calls";

export async function POST(request, { params }) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return NextResponse.json({error:"אין הרשאה."}, {status:403});
    const user = await getCurrentAppUser();
    const { sessionId } = await params;
    const body = await request.json();
    if (body.kind === "team") {
      await saveCallTeam(sessionId, body.studentIds, user);
      return NextResponse.json({ ok:true });
    }
    if (body.kind === "claim") return NextResponse.json(await claimAttendanceCall(sessionId, user));
    if (body.kind === "finish") return NextResponse.json(await finishAttendanceCall(sessionId, body, user));
    return NextResponse.json({error:"פעולה לא מוכרת."}, {status:400});
  } catch (error) {
    if (error instanceof CallQueueError) return NextResponse.json({ error:error.message }, {status:error.status});
    console.error("Attendance call queue failed", error);
    return NextResponse.json({error:"לא ניתן להשלים את הפעולה כרגע. נסה שוב."}, {status:500});
  }
}
