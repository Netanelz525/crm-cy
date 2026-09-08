import { redirect } from "next/navigation";
import { getCurrentAppUser } from "../../lib/rbac";
import { listAllNeonStudents } from "../../lib/neon-students";
import { listCallAssignments } from "../../lib/student-call-assignments";
import CallDeskClient from "./call-desk-client";
import Link from "next/link";
import { listMyCallSessions } from "../../lib/attendance-calls";
import { ATTENDANCE_SESSION_TYPE_LABELS } from "../../lib/attendance";

export default async function CallDeskPage() {
  const user = await getCurrentAppUser();
  if (!user) redirect("/sign-in?redirect_url=/call-desk");
  if (user.access_status !== "approved") redirect("/unauthorized");
  const sessions = await listMyCallSessions(user);
  const [students, assignments] = await Promise.all([listAllNeonStudents(), listCallAssignments()]);
  const mine = assignments.filter((item) => (item.assignee_user_id === user.clerk_user_id || (user.linked_student_id && item.assignee_student_id === user.linked_student_id)) && item.status === "pending");
  const byId = new Map(students.map((student) => [student.id, student]));
  return <><section className="card"><h1>שיחות למפגשים</h1>
    {sessions.length ? sessions.map(session => <div key={session.id} className="quick-actions">
      <Link href={`/call-desk/attendance/${session.id}`}>{session.title || ATTENDANCE_SESSION_TYPE_LABELS[session.session_type] || "מפגש"} · {String(session.session_date).slice(0,10)}</Link>
      {session.is_locked ? <span>נעול</span> : null}
    </div>) : <p className="muted">אין מפגשים המשויכים אליך לצורך שיחות.</p>}
  </section><CallDeskClient students={mine.map((item) => byId.get(item.student_id)).filter(Boolean)} /></>;
}
