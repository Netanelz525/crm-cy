import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAppUser, listAppUsers } from "../../../lib/rbac";
import { listAllNeonStudents } from "../../../lib/neon-students";
import { listCallAssignments } from "../../../lib/student-call-assignments";
import { listMyCallSessions } from "../../../lib/attendance-calls";

export default async function CallDeskManagePage() {
  const user=await getCurrentAppUser(); if(!user)redirect("/sign-in"); if(!user.is_manager&&!user.is_super_admin)redirect("/unauthorized");
  const [students,users,assignments]=await Promise.all([listAllNeonStudents(),listAppUsers(),listCallAssignments()]);
  const names=new Map(students.map((s)=>[s.id,s.label||s.name||s.id])); const userNames=new Map(users.map((u)=>[u.clerk_user_id,u.display_name||u.email]));
  const pending=assignments.filter((a)=>a.status==="pending").length, completed=assignments.filter((a)=>a.status==="completed").length;
  const callSessions = await listMyCallSessions(user);
  return <><section className="card"><h2>צוותי שיחות למפגשים</h2><p>בחירת תלמידים אחראים ותיעוד השיחות נמצאים בתוך כל מפגש.</p><Link href="/attendance">כל המפגשים</Link>{callSessions.map(s=><p key={s.id}><Link href={`/attendance/${s.id}`}>{s.title || "מפגש"} — צוות והתקדמות</Link></p>)}</section><section className="card"><h1>ניהול אזור השיחות</h1><div className="quick-actions"><span className="linked-record-pill">ממתינים: {pending}</span><span className="linked-record-pill">הושלמו: {completed}</span><Link className="quick-action-btn quick-action-outline" href="/payments/linking">הקצאת אחראים</Link></div></section><section className="card"><div className="payment-student-table">{assignments.map((a)=><div className="payment-student-row" key={a.student_id}><b>{names.get(a.student_id)||a.student_id}</b><span>{a.assignee_student_id?names.get(a.assignee_student_id):userNames.get(a.assignee_user_id)||"-"}</span><span>{a.assignee_student_id?"תלמיד אחראי":"איש צוות"}</span><span className={a.status==="completed"?"payment-linked":"payment-unlinked"}>{a.status==="completed"?"הושלם":"ממתין"}</span><Link href={`/neon/students/${a.student_id}`}>פתח כרטיס</Link></div>)}</div></section></>;
}
