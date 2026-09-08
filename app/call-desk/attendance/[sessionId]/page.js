import { redirect } from "next/navigation";
import { getCurrentAppUser } from "../../../../lib/rbac";
import { listMyCallSessions } from "../../../../lib/attendance-calls";
import AttendanceCallClient from "../attendance-call-client";

export default async function Page({ params }) {
  const user = await getCurrentAppUser();
  if (!user) redirect("/sign-in?redirect_url=/call-desk");
  if (user.access_status !== "approved") redirect("/unauthorized");
  const { sessionId } = await params;
  const sessions = await listMyCallSessions(user);
  const session = sessions.find(s => s.id === sessionId);
  if (!session) redirect("/unauthorized");
  return <AttendanceCallClient sessionId={sessionId} title={session.title || "מוקד מפגש"} locked={session.is_locked} />;
}
