import { redirect } from "next/navigation";
import { getCurrentAppUser } from "../../../../lib/rbac";
import { listMyCallSessions, getAttendanceCallRoster } from "../../../../lib/attendance-calls";
import AttendanceCallClient from "../attendance-call-client";

export default async function Page({ params, searchParams }) {
  const selectedStatus = String((await searchParams)?.status || "");
  const { sessionId } = await params;
  const returnTo = `/call-desk/attendance/${encodeURIComponent(sessionId)}${selectedStatus ? `?status=${encodeURIComponent(selectedStatus)}` : ""}`;
  const user = await getCurrentAppUser();
  if (!user) redirect(`/sign-in?redirect_url=${encodeURIComponent(returnTo)}`);
  if (user.access_status !== "approved" || !user.can_call_attendance) redirect("/unauthorized");
  const sessions = await listMyCallSessions(user);
  const session = sessions.find(s => s.id === sessionId);
  if (!session) redirect("/unauthorized");
  const roster=session.is_locked?null:await getAttendanceCallRoster(sessionId,user);
  return <AttendanceCallClient initialStatus={selectedStatus} statusOptions={roster?.session.statusOptions||[]} sessionId={sessionId} title={session.title || "מוקד מפגש"} locked={session.is_locked} />;
}
